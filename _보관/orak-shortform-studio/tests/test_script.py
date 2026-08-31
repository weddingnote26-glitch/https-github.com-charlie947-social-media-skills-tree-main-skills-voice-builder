"""대본 시험 — Stage 4.

완료 기준: **입력 → 장면 5개 JSON 생성, 화면에서 수정 가능.**

    python tests/test_script.py

실제 API 는 부르지 않습니다. 열쇠가 없고, 이 작업 환경에서 막혀 있기 때문입니다.
대신 **가짜 client** 를 넣어 흐름 전체를 확인합니다 — 규칙 검사, 다시 만들기,
광고 표시 강제, 오류 번역, 비용 계산까지.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.contracts.errors import ProviderError, Retry, SecretStr  # noqa: E402
from app.contracts.models import (  # noqa: E402
    MAX_TOTAL_SEC,
    AdDisclosure,
    RenderMode,
    StoreInfo,
)
from app.contracts.providers import ScriptProvider  # noqa: E402
from app.core import masking  # noqa: E402
from app.core.script_rules import (  # noqa: E402
    AD_PREFIX,
    check_script,
    ensure_ad_prefix,
    find_forbidden_words,
)
from app.providers.llm_claude import (  # noqa: E402
    DEFAULT_MODEL,
    MAX_REGENERATE,
    SCRIPT_SCHEMA,
    ClaudeScriptProvider,
    build_system_prompt,
    build_user_prompt,
)

# ═════════════════════════════════════════════════════════════
# 거리
# ═════════════════════════════════════════════════════════════

GOOD = {
    "hook": "신림에 6천 원짜리 수상한 집이 있습니다.",
    "full_text": "골목 안쪽 오래된 국수집입니다. 멸치로 국물을 냅니다.",
    "title": "신림 6천원 손칼국수",
    "caption": "신림 골목 안쪽 국수집입니다.",
    "hashtags": ["#관악5070", "#신림맛집", "#손칼국수", "#가성비", "#동네맛집"],
    "scenes": [
        {"idx": 1, "start_sec": 0, "end_sec": 3, "render_mode": "kling",
         "narration": "6천 원짜리 수상한 집", "screen_text": "6천 원?",
         "image_prompt": "surprised detective in a narrow alley", "video_prompt": "slight lean in"},
        {"idx": 2, "start_sec": 3, "end_sec": 7, "render_mode": "kenburns",
         "narration": "골목 안쪽 오래된 국수집입니다", "screen_text": "신림동 골목",
         "image_prompt": "old noodle shop front", "video_prompt": ""},
        {"idx": 3, "start_sec": 7, "end_sec": 12, "render_mode": "kenburns",
         "narration": "멸치로 국물을 냅니다", "screen_text": "멸치 손칼국수",
         "image_prompt": "hot noodle bowl close up", "video_prompt": ""},
        {"idx": 4, "start_sec": 12, "end_sec": 17, "render_mode": "kling",
         "narration": "한 입 먹으니 국물이 깊습니다", "screen_text": "국물이 깊다",
         "image_prompt": "detective tasting, warm expression", "video_prompt": "slow nod"},
        {"idx": 5, "start_sec": 17, "end_sec": 23, "render_mode": "kenburns",
         "narration": "6천 원이고 역에서 5분입니다", "screen_text": "6,000원 · 도보 5분",
         "image_prompt": "menu board and street", "video_prompt": ""},
    ],
}

STORE = StoreInfo(
    store_name="할머니 손칼국수", area="신림", address="관악구 신림로 00길 0",
    menu="손칼국수", price="6,000원", features="멸치 국물 · 면을 직접 뽑음",
    reason="이 가격에 이 양이 드뭅니다",
    disclosure=AdDisclosure(is_paid=False),
)
PAID_STORE = StoreInfo(
    store_name="할머니 손칼국수", area="신림", address="관악구 신림로 00길 0",
    menu="손칼국수", price="6,000원", features="멸치 국물",
    reason="가성비", disclosure=AdDisclosure(is_paid=True),
)


class FakeClient:
    """정해둔 답을 차례로 돌려주는 가짜 client. API 를 부르지 않습니다."""

    def __init__(self, *payloads, raise_on_first: Exception | None = None) -> None:
        self._payloads = list(payloads)
        self._raise = raise_on_first
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._raise is not None:
            exc, self._raise = self._raise, None
            raise exc
        payload = self._payloads.pop(0) if len(self._payloads) > 1 else self._payloads[0]
        return SimpleNamespace(
            content=[SimpleNamespace(type="text",
                                     text=json.dumps(payload, ensure_ascii=False))],
            usage=SimpleNamespace(input_tokens=1500, output_tokens=2500,
                                  cache_read_input_tokens=1200),
        )


PRICING = {"환율": 1380.0, "입력_백만당_달러": 5.0, "출력_백만당_달러": 25.0}


def _provider(*payloads, **kw) -> ClaudeScriptProvider:
    return ClaudeScriptProvider(client=FakeClient(*payloads), pricing=PRICING, **kw)


# ═════════════════════════════════════════════════════════════
# 규칙 (API 없이 검사만)
# ═════════════════════════════════════════════════════════════


def test_좋은_대본은_통과한다() -> None:
    assert check_script(GOOD, is_paid_promotion=False) == []


def test_30초를_넘으면_어느_장면을_줄일지_알려준다() -> None:
    """§8 — 자동으로 잘라내지 않습니다."""
    bad = copy.deepcopy(GOOD)
    bad["scenes"][-1]["end_sec"] = 40
    problems = check_script(bad, is_paid_promotion=False)
    긴것 = [p for p in problems if "30초까지" in p.message]
    assert 긴것, "30초 초과를 못 잡았습니다"
    assert 긴것[0].fix, "어느 장면을 줄일지 알려줘야 합니다"
    assert "장면 5" in 긴것[0].fix


def test_영상_장면이_한도를_넘으면_잡는다() -> None:
    """비용의 대부분이 여기서 나옵니다 (§1-1)."""
    bad = copy.deepcopy(GOOD)
    bad["scenes"][1]["render_mode"] = "kling"
    문제 = [p for p in check_script(bad, is_paid_promotion=False)
            if "영상으로 만드는 장면" in p.message]
    assert 문제, "Kling 3개를 못 잡았습니다"
    assert check_script(bad, is_paid_promotion=False, max_kling_clips=3) == [], \
        "한도를 3으로 올리면 통과해야 합니다"


def test_읽을_수_없는_길이를_잡는다() -> None:
    """한국어는 초당 5~6자입니다 (§6)."""
    bad = copy.deepcopy(GOOD)
    bad["scenes"][0]["narration"] = "가" * 60      # 3초 장면에 60자
    문제 = [p for p in check_script(bad, is_paid_promotion=False)
            if "너무 깁니다" in p.message]
    assert 문제, "너무 긴 낭독을 못 잡았습니다"
    assert "18자까지" in 문제[0].message, 문제[0].message


def test_자막_16자_규칙() -> None:
    bad = copy.deepcopy(GOOD)
    bad["scenes"][0]["screen_text"] = "이건 정말 너무너무 긴 자막이라 안 들어갑니다"
    assert [p for p in check_script(bad, is_paid_promotion=False)
            if "한 줄 16자" in p.message]


def test_자막_2줄_규칙() -> None:
    bad = copy.deepcopy(GOOD)
    bad["scenes"][0]["screen_text"] = "한 줄\n두 줄\n세 줄"
    assert [p for p in check_script(bad, is_paid_promotion=False)
            if "2줄까지" in p.message]


def test_과장_표현을_잡는다() -> None:
    """§6 — 근거 없는 최상급은 부당 표시광고가 될 수 있습니다."""
    for 나쁜말 in ("최고", "1등", "무조건", "대박", "역대급", "여기 아니면 없는"):
        assert find_forbidden_words(f"여기가 {나쁜말} 입니다"), f"{나쁜말} 을 못 잡았습니다"
    bad = copy.deepcopy(GOOD)
    bad["scenes"][0]["narration"] = "신림 최고의 맛집"
    assert [p for p in check_script(bad, is_paid_promotion=False)
            if "쓰면 안 되는 표현" in p.message]


def test_장면_시간이_이어져야_한다() -> None:
    bad = copy.deepcopy(GOOD)
    bad["scenes"][2]["start_sec"] = 9          # 앞 장면은 7초에 끝남
    assert [p for p in check_script(bad, is_paid_promotion=False)
            if "빈 시간" in p.message]


def test_장면_수는_4에서_6개다() -> None:
    bad = copy.deepcopy(GOOD)
    bad["scenes"] = bad["scenes"][:2]
    assert [p for p in check_script(bad, is_paid_promotion=False)
            if "4~6개" in p.message]


# ═════════════════════════════════════════════════════════════
# 광고 표시 (§5)
# ═════════════════════════════════════════════════════════════


def test_대가성이면_게시글_맨앞에_붙는다() -> None:
    붙임 = ensure_ad_prefix("맛있어요", is_paid_promotion=True)
    assert 붙임.startswith(AD_PREFIX)
    assert ensure_ad_prefix("맛있어요", is_paid_promotion=False) == "맛있어요"


def test_두번_붙지_않는다() -> None:
    한번 = ensure_ad_prefix("맛있어요", is_paid_promotion=True)
    assert ensure_ad_prefix(한번, is_paid_promotion=True).count(AD_PREFIX) == 1


def test_AI가_빠뜨려도_프로그램이_붙인다() -> None:
    """담당자도 AI 도 끌 수 없습니다."""
    빠뜨린것 = copy.deepcopy(GOOD)
    빠뜨린것["caption"] = "그냥 설명입니다"          # 광고 표시 없음
    result = _provider(빠뜨린것).generate_detailed(PAID_STORE)
    assert result.script.caption.startswith(AD_PREFIX), \
        "AI 가 빠뜨렸는데 프로그램도 안 붙였습니다"


# ═════════════════════════════════════════════════════════════
# 만들기 흐름
# ═════════════════════════════════════════════════════════════


def test_계약을_지킨다() -> None:
    assert isinstance(_provider(GOOD), ScriptProvider)


def test_입력하면_장면_5개가_나온다() -> None:
    """Stage 4 완료 기준입니다."""
    script = _provider(GOOD).generate(STORE)
    assert len(script.scenes) == 5
    assert [s.idx for s in script.scenes] == [1, 2, 3, 4, 5]
    assert script.total_sec <= MAX_TOTAL_SEC
    assert len(script.kling_scenes) == 2
    assert script.hook and script.title and script.hashtags


def test_규칙을_어기면_다시_만든다() -> None:
    """§6 — 스키마를 벗어나면 최대 2회 재생성."""
    나쁜것 = copy.deepcopy(GOOD)
    나쁜것["scenes"][0]["narration"] = "가" * 60
    p = _provider(나쁜것, GOOD)                   # 첫 답은 나쁘고, 두 번째는 좋음
    result = p.generate_detailed(STORE)
    assert result.attempts == 2, f"{result.attempts}번 시도했습니다"
    assert result.remaining_problems == []


def test_다시_만드는_횟수에_상한이_있다() -> None:
    """계속 실패해도 돈이 무한정 나가면 안 됩니다."""
    나쁜것 = copy.deepcopy(GOOD)
    나쁜것["scenes"][0]["narration"] = "가" * 60
    result = _provider(나쁜것).generate_detailed(STORE)   # 늘 나쁜 답
    assert result.attempts == MAX_REGENERATE + 1 == 3
    assert result.remaining_problems, "고치지 못한 문제를 알려줘야 합니다"


def test_다시_만들때_무엇이_틀렸는지_알려준다() -> None:
    나쁜것 = copy.deepcopy(GOOD)
    나쁜것["scenes"][0]["narration"] = "가" * 60
    client = FakeClient(나쁜것, GOOD)
    ClaudeScriptProvider(client=client, pricing=PRICING).generate_detailed(STORE)
    두번째 = client.calls[1]["messages"][-1]["content"]
    assert "규칙을 어겼습니다" in 두번째
    assert "너무 깁니다" in 두번째


# ═════════════════════════════════════════════════════════════
# 요청 모양 (공식 문서대로인가)
# ═════════════════════════════════════════════════════════════


def test_요청이_공식_문서대로다() -> None:
    client = FakeClient(GOOD)
    ClaudeScriptProvider(client=client, pricing=PRICING).generate(STORE)
    req = client.calls[0]

    assert req["model"] == DEFAULT_MODEL == "claude-opus-5"
    assert req["thinking"] == {"type": "adaptive"}, "적응형 사고를 써야 합니다"
    assert req["output_config"]["format"]["type"] == "json_schema"
    assert req["output_config"]["format"]["schema"] is SCRIPT_SCHEMA
    assert "output_format" not in req, "output_format 은 폐기된 인자입니다"
    assert "budget_tokens" not in json.dumps(req), "budget_tokens 는 400 을 냅니다"
    # 마지막 메시지가 assistant 면 prefill 인데, Opus 5 에서는 400 입니다.
    assert req["messages"][-1]["role"] == "user"


def test_바뀌지_않는_부분에_캐시를_건다() -> None:
    """한 달 20편에 재생성까지 하면 캐시가 값을 합니다."""
    client = FakeClient(GOOD)
    ClaudeScriptProvider(client=client, pricing=PRICING).generate(STORE)
    system = client.calls[0]["system"]
    assert isinstance(system, list)
    assert system[0]["cache_control"] == {"type": "ephemeral"}


def test_가게_정보는_캐시_뒤에_온다() -> None:
    """가게 이름을 시스템 프롬프트에 섞으면 매번 캐시가 깨집니다."""
    system = build_system_prompt()
    assert "할머니 손칼국수" not in system
    assert "신림로" not in system
    user = build_user_prompt(STORE, 5)
    assert "할머니 손칼국수" in user


def test_스키마가_장면_수를_제한한다() -> None:
    scenes = SCRIPT_SCHEMA["properties"]["scenes"]
    assert scenes["minItems"] == 4 and scenes["maxItems"] == 6
    assert SCRIPT_SCHEMA["additionalProperties"] is False
    assert set(SCRIPT_SCHEMA["properties"]["scenes"]["items"]["properties"]) >= {
        "idx", "start_sec", "end_sec", "render_mode", "narration",
        "screen_text", "image_prompt", "video_prompt"}


def test_영상_장면_한도가_프롬프트에_들어간다() -> None:
    assert "최대 2개" in build_system_prompt(max_kling_clips=2)
    assert "최대 3개" in build_system_prompt(max_kling_clips=3)


# ═════════════════════════════════════════════════════════════
# 오류와 비용
# ═════════════════════════════════════════════════════════════


def _err(status: int) -> Exception:
    e = RuntimeError("vendor said no")
    e.status_code = status          # type: ignore[attr-defined]
    return e


def test_오류를_한국어로_바꾼다() -> None:
    """§9 — 개발자 로그를 담당자에게 보여주지 않습니다."""
    표 = {
        401: (Retry.NEVER_AUTH, "회사에 문의"),
        400: (Retry.NEVER_PARAM, "확인해 주세요"),
        429: (Retry.BACKOFF, "잠시 뒤"),
        500: (Retry.BACKOFF, "잠시 뒤"),
    }
    for status, (retry, 조각) in 표.items():
        p = ClaudeScriptProvider(client=FakeClient(GOOD, raise_on_first=_err(status)),
                                 pricing=PRICING)
        try:
            p.generate(STORE)
        except ProviderError as e:
            assert e.retry is retry, f"{status}: {e.retry}"
            assert 조각 in e.user_message, e.user_message
            assert "RuntimeError" not in e.user_message, "파이썬 오류형이 새어나갔습니다"
            assert str(status) not in e.user_message, "상태코드가 화면 문구에 있습니다"
        else:  # pragma: no cover
            raise AssertionError(f"{status} 인데 예외가 안 났습니다")


def test_파라미터_오류는_재시도하지_않는다() -> None:
    """MVP 판정 22번."""
    p = ClaudeScriptProvider(client=FakeClient(GOOD, raise_on_first=_err(400)),
                             pricing=PRICING)
    try:
        p.generate(STORE)
    except ProviderError as e:
        assert e.retry.is_automatic is False


def test_오류_기록에_열쇠가_안_남는다() -> None:
    비밀 = "sk-ant-api03-SCRIPT-TEST-abcdefghij"
    masking.register(비밀)
    e = RuntimeError(f"auth failed with key {비밀}")
    e.status_code = 401                       # type: ignore[attr-defined]
    p = ClaudeScriptProvider(client=FakeClient(GOOD, raise_on_first=e), pricing=PRICING)
    try:
        p.generate(STORE)
    except ProviderError as err:
        assert 비밀 not in err.log_detail, "기록에 열쇠가 남았습니다"
        assert 비밀 not in err.user_message


def test_열쇠가_없으면_한국어로_알려준다() -> None:
    try:
        ClaudeScriptProvider()
    except ProviderError as e:
        assert e.retry is Retry.NEVER_AUTH
        assert "설정에서 넣어주세요" in e.user_message


def test_비용을_원화로_계산한다() -> None:
    p = _provider(GOOD)
    est = p.estimate(STORE, 5)
    assert est.is_complete and est.krw > 0
    # 입력 1500 · 출력 2500 토큰 = ($0.0075 + $0.0625) × 1380 ≈ 97원
    assert 90 <= est.krw <= 105, est.krw
    assert p.cost_krw(1_000_000, 1_000_000) == round((5.0 + 25.0) * 1380)


def test_요금을_모르면_모른다고_한다() -> None:
    """§11 — 숨기지 않고 「일부 요금 미확인」 으로 표시합니다."""
    p = ClaudeScriptProvider(client=FakeClient(GOOD), pricing={})
    assert p.estimate(STORE, 5).is_complete is False


def test_실제로_쓴_토큰을_돌려준다() -> None:
    """§11 — generation_jobs 에 적을 값입니다."""
    r = _provider(GOOD).generate_detailed(STORE)
    assert r.input_tokens == 1500 and r.output_tokens == 2500
    assert r.cached_tokens == 1200, "캐시가 걸렸는지 봐야 합니다"


def test_요금표에_실제_단가가_들어있다() -> None:
    import io

    d = json.load(io.open(Path(__file__).resolve().parent.parent
                          / "assets" / "pricing.json", encoding="utf-8"))
    m = d["대본_claude"]["모델별"]["claude-opus-5"]
    assert m["입력_백만당_달러"] == 5.0
    assert m["출력_백만당_달러"] == 25.0
    assert d["대본_claude"]["기본모델"] == DEFAULT_MODEL


if __name__ == "__main__":
    import traceback

    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    통과 = 실패 = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  통과   {name}")
            통과 += 1
        except Exception:
            print(f"  실패 ✗ {name}")
            traceback.print_exc()
            실패 += 1
    print(f"\n{통과}개 통과, {실패}개 실패 (전체 {len(tests)}개)")
    sys.exit(1 if 실패 else 0)
