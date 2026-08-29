"""공급자 시험 — OpenAI(대본·이미지) · ElevenLabs(목소리) · Kling(영상).

**진짜로 부르지 않습니다.** 가짜 HTTP 를 끼워 넣어 흐름만 봅니다.
돈이 나가는 곳이라 시험이 실수로 부르면 안 됩니다.

가장 중요한 것: **모델 이름을 추측해서 코드에 박아두지 않았는가** (§0-2).

    python tests/test_providers.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.contracts.errors import ProviderError, Retry, SecretStr  # noqa: E402
from app.contracts.models import AdDisclosure, StoreInfo  # noqa: E402
from app.contracts.providers import (  # noqa: E402
    ImageProvider,
    ScriptProvider,
    TTSProvider,
    VideoProvider,
)
from app.core import masking  # noqa: E402
from app.core.db import Database  # noqa: E402
from app.core.http import HttpError, HttpResponse  # noqa: E402
from app.providers.image_openai import OpenAIImageProvider  # noqa: E402
from app.providers.llm_openai import OpenAIScriptProvider  # noqa: E402
from app.providers.tts_elevenlabs import ElevenLabsTTSProvider  # noqa: E402
from app.providers.video_kenburns import KenBurnsProvider  # noqa: E402
from app.services.registry import NotBuiltYet, ProviderRegistry  # noqa: E402

KEY = SecretStr("sk-test-REALSECRETVALUE1234567890")


class FakeHttp:
    """부른 것을 적어 두고, 미리 정해 둔 답을 돌려줍니다."""

    def __init__(self, *답들: HttpResponse) -> None:
        self.답들 = list(답들)
        self.calls: list[dict] = []

    def request(self, method, url, *, headers=None, json=None, data=None,
                timeout=120.0):
        self.calls.append({"method": method, "url": url,
                           "headers": dict(headers or {}), "json": json})
        if not self.답들:
            return HttpResponse(200, b"{}")
        return self.답들.pop(0) if len(self.답들) > 1 else self.답들[0]


class DeadHttp:
    def request(self, *a, **kw):
        raise HttpError("ConnectionError: 인터넷 없음")


def _ok(obj) -> HttpResponse:
    return HttpResponse(200, json.dumps(obj).encode())


def _bad(status: int, msg: str = "nope") -> HttpResponse:
    return HttpResponse(status, json.dumps({"error": {"message": msg}}).encode())


MODELS = _ok({"data": [{"id": "가상모델-A"}, {"id": "가상모델-B"}]})

GOOD_SCRIPT = {
    "hook": "신림에 6천 원짜리 수상한 집이 있습니다.",
    "full_text": "신림동 골목 안쪽입니다. 멸치로 국물을 냅니다.",
    "title": "신림 6천원 손칼국수",
    "caption": "신림동 할머니 손칼국수 다녀왔습니다.",
    "hashtags": ["#신림맛집", "#손칼국수", "#신림동", "#동네맛집", "#가성비"],
    "scenes": [
        {"idx": 1, "start_sec": 0, "end_sec": 3, "render_mode": "kling",
         "narration": "육천 원?", "screen_text": "6천 원?",
         "image_prompt": "detective", "video_prompt": "slow zoom"},
        {"idx": 2, "start_sec": 3, "end_sec": 10, "render_mode": "kenburns",
         "narration": "신림동 골목 안쪽입니다.", "screen_text": "신림동 골목",
         "image_prompt": "alley", "video_prompt": ""},
        {"idx": 3, "start_sec": 10, "end_sec": 20, "render_mode": "kenburns",
         "narration": "멸치로 국물을 냅니다.", "screen_text": "멸치 국물",
         "image_prompt": "noodle", "video_prompt": ""},
        {"idx": 4, "start_sec": 20, "end_sec": 28, "render_mode": "kenburns",
         "narration": "도보 오 분입니다.", "screen_text": "도보 5분",
         "image_prompt": "sign", "video_prompt": ""},
    ],
}


def _chat(obj) -> HttpResponse:
    return _ok({"choices": [{"message": {"content": json.dumps(obj)}}]})


def _store() -> StoreInfo:
    return StoreInfo(store_name="할머니 손칼국수", area="신림동",
                     address="서울 관악구", menu="손칼국수", price="6,000원",
                     features="멸치 육수", reason="가격 대비 훌륭",
                     disclosure=AdDisclosure(is_paid=False))


# ═════════════════════════════════════════════════════════
# §0-2 — 모델 이름을 추측해 박아두지 않았는가
# ═════════════════════════════════════════════════════════


def test_모델_이름이_코드에_박혀있지_않다() -> None:
    """이번 지시서: 「모델명을 코드 여러 군데에 하드코딩하지 말고 설정값으로」."""
    for p in (OpenAIScriptProvider(), OpenAIImageProvider(),
              ElevenLabsTTSProvider()):
        assert getattr(p, "model", "") == "", f"{p.name} 에 기본 모델이 박혀 있습니다"
    assert ElevenLabsTTSProvider().voice_id == ""


def test_모델을_안_고르면_부르지_않고_멈춘다() -> None:
    """가짜 이름으로 넘겨보지 않습니다. 돈이 나가거나 엉뚱한 답이 옵니다."""
    http = FakeHttp(_chat(GOOD_SCRIPT))
    p = OpenAIScriptProvider(api_key=KEY, http=http)
    try:
        p.generate(_store(), 4)
    except ProviderError as e:
        assert e.retry is Retry.NEVER_PARAM
        assert "골라주세요" in e.user_message
    else:
        raise AssertionError("모델 없이 그냥 불렀습니다")
    assert http.calls == [], "모델도 없이 진짜로 불렀습니다"


def test_모델_목록은_계정에_물어본다() -> None:
    http = FakeHttp(MODELS)
    목록 = OpenAIScriptProvider(api_key=KEY, http=http).list_models()
    assert 목록 == [("가상모델-A", "가상모델-A"), ("가상모델-B", "가상모델-B")]
    assert http.calls[0]["url"].endswith("/models")
    assert http.calls[0]["method"] == "GET"


def test_고른_모델을_못_쓰면_알려준다() -> None:
    p = OpenAIScriptProvider(api_key=KEY, http=FakeHttp(MODELS), model="없는모델")
    됐나, 말 = p.health()
    assert 됐나 is False
    assert "다시 골라주세요" in 말


# ═════════════════════════════════════════════════════════
# 대본 (OpenAI)
# ═════════════════════════════════════════════════════════


def test_대본_공급자가_계약을_지킨다() -> None:
    assert isinstance(OpenAIScriptProvider(), ScriptProvider)


def test_대본을_만든다() -> None:
    http = FakeHttp(_chat(GOOD_SCRIPT))
    p = OpenAIScriptProvider(api_key=KEY, http=http, model="가상모델-A")
    대본 = p.generate(_store(), 4)
    assert 대본.title == "신림 6천원 손칼국수"
    assert len(대본.scenes) == 4
    assert 대본.scenes[0].render_mode.value == "kling"
    보낸것 = http.calls[0]["json"]
    assert 보낸것["model"] == "가상모델-A"
    assert 보낸것["response_format"]["json_schema"]["strict"] is True


def test_규칙이_대본_요청에_실려_간다() -> None:
    """「기본 제작 필수 규칙」 이 진짜로 공급자까지 갑니다."""
    http = FakeHttp(_chat(GOOD_SCRIPT))
    p = OpenAIScriptProvider(api_key=KEY, http=http, model="가상모델-A")
    p.generate(_store(), 4, extra_prompt="[대본을 쓸 때 지킬 것]\n- 가격을 꼭 말한다.")
    보낸글 = " ".join(m["content"] for m in http.calls[0]["json"]["messages"])
    assert "가격을 꼭 말한다." in 보낸글, "규칙이 공급자까지 가지 않았습니다"
    assert "할머니 손칼국수" in 보낸글


def test_엄격모드가_받지_않는_열쇠말을_걷어낸다() -> None:
    from app.providers.llm_openai import _SCHEMA
    글 = json.dumps(_SCHEMA)
    assert "minItems" not in 글 and "maxItems" not in 글
    assert _SCHEMA["additionalProperties"] is False


def test_대본_규칙을_어기면_다시_만든다() -> None:
    """§6 — 형식을 벗어나면 최대 2번 다시."""
    나쁜것 = json.loads(json.dumps(GOOD_SCRIPT))
    나쁜것["scenes"][0]["narration"] = "역대급 대박 최고 무조건 1등 맛집입니다"
    http = FakeHttp(_chat(나쁜것), _chat(GOOD_SCRIPT))
    p = OpenAIScriptProvider(api_key=KEY, http=http, model="가상모델-A")
    p.generate(_store(), 4)
    assert len(http.calls) >= 2, "규칙을 어겼는데 다시 만들지 않았습니다"
    두번째 = " ".join(m["content"] for m in http.calls[1]["json"]["messages"])
    assert "규칙을 어겼습니다" in 두번째, "무엇이 틀렸는지 안 알려줬습니다"


def test_계속_어기면_포기하고_알려준다() -> None:
    나쁜것 = json.loads(json.dumps(GOOD_SCRIPT))
    나쁜것["scenes"][0]["narration"] = "역대급 대박 최고 무조건 1등 맛집입니다"
    http = FakeHttp(_chat(나쁜것))
    p = OpenAIScriptProvider(api_key=KEY, http=http, model="가상모델-A")
    try:
        p.generate(_store(), 4)
    except ProviderError as e:
        assert "다시" in e.user_message or "바꿔" in e.user_message
    else:
        raise AssertionError("끝없이 다시 만들었습니다")
    assert len(http.calls) == 3, f"{len(http.calls)}번 불렀습니다 (1+2 이어야 합니다)"


# ═════════════════════════════════════════════════════════
# 이미지 (OpenAI)
# ═════════════════════════════════════════════════════════


def test_이미지_공급자가_계약을_지킨다() -> None:
    assert isinstance(OpenAIImageProvider(), ImageProvider)


def test_이미지를_받아_파일로_저장한다() -> None:
    import base64
    그림 = base64.b64encode(b"\x89PNG\r\n\x1a\n fake").decode()
    http = FakeHttp(_ok({"data": [{"b64_json": 그림}]}))
    p = OpenAIImageProvider(api_key=KEY, http=http, model="가상이미지")
    dest = Path(tempfile.mkdtemp()) / "장면1.png"
    난것 = p.generate_scene_image(prompt="탐정 오락이", dest=dest)
    assert 난것.is_file() and 난것.read_bytes().startswith(b"\x89PNG")
    assert http.calls[0]["json"]["size"] == "1080x1920", "세로 규격이 아닙니다"


def test_주소로_오면_곧바로_내려받는다() -> None:
    """주소만 갖고 있으면 나중에 사라집니다 (Kling 30일 규칙과 같은 이유)."""
    http = FakeHttp(_ok({"data": [{"url": "https://example.invalid/a.png"}]}),
                    HttpResponse(200, b"\x89PNG\r\n\x1a\n fake"))
    p = OpenAIImageProvider(api_key=KEY, http=http, model="가상이미지")
    dest = Path(tempfile.mkdtemp()) / "장면1.png"
    p.generate_scene_image(prompt="x", dest=dest)
    assert dest.read_bytes().startswith(b"\x89PNG")
    assert len(http.calls) == 2, "받은 주소를 내려받지 않았습니다"


def test_요금을_모르면_0원이라고_하지_않는다() -> None:
    """§9 — 모르면 모른다고 해야 한도 계산이 무너지지 않습니다."""
    값 = OpenAIImageProvider().estimate(5)
    assert 값.is_complete is False, "요금을 모르는데 안다고 했습니다"
    값2 = OpenAIImageProvider(pricing={"장당_달러": 0.04, "환율": 1380}).estimate(5)
    assert 값2.is_complete is True and 값2.krw == 276


# ═════════════════════════════════════════════════════════
# 목소리 (ElevenLabs)
# ═════════════════════════════════════════════════════════


def test_목소리_공급자가_계약을_지킨다() -> None:
    assert isinstance(ElevenLabsTTSProvider(), TTSProvider)


def test_목소리와_모델_목록을_계정에_물어본다() -> None:
    http = FakeHttp(
        _ok([{"model_id": "가상음성모델", "name": "가상",
              "languages": [{"language_id": "ko", "name": "Korean"}]}]))
    목록 = ElevenLabsTTSProvider(api_key=KEY, http=http).list_models()
    assert 목록 == [("가상음성모델", "가상 · 한국어 됨")], 목록

    http2 = FakeHttp(_ok({"voices": [{"voice_id": "v1", "name": "가상 목소리"}]}))
    assert ElevenLabsTTSProvider(api_key=KEY, http=http2).list_voices() == \
        [("v1", "가상 목소리")]


def test_목소리를_안_고르면_부르지_않는다() -> None:
    http = FakeHttp(HttpResponse(200, b"\xff\xfb audio"))
    p = ElevenLabsTTSProvider(api_key=KEY, http=http)
    try:
        p.synthesize(text="안녕하세요", dest=Path(tempfile.mkdtemp()) / "a.mp3")
    except ProviderError as e:
        assert e.retry is Retry.NEVER_PARAM
    else:
        raise AssertionError("목소리도 안 고르고 불렀습니다")
    assert http.calls == []


def test_목소리를_만들어_파일로_저장한다() -> None:
    http = FakeHttp(HttpResponse(200, b"\xff\xfb fake mp3"))
    p = ElevenLabsTTSProvider(api_key=KEY, http=http, model="가상음성모델",
                              voice_id="v1")
    dest = Path(tempfile.mkdtemp()) / "장면1.mp3"
    p.synthesize(text="안녕하세요", dest=dest)
    assert dest.read_bytes() == b"\xff\xfb fake mp3"
    assert "/text-to-speech/v1" in http.calls[0]["url"]
    assert http.calls[0]["json"]["model_id"] == "가상음성모델"
    assert "44100" in http.calls[0]["url"], "합성 규격(44.1kHz)에 안 맞춥니다"


def test_열쇠는_xi_api_key_머리로_간다() -> None:
    http = FakeHttp(_ok([]))
    ElevenLabsTTSProvider(api_key=KEY, http=http).list_models()
    assert http.calls[0]["headers"].get("xi-api-key") == KEY.reveal()


# ═════════════════════════════════════════════════════════
# 영상 (Kling 은 아직 · 사진 움직이기는 됨)
# ═════════════════════════════════════════════════════════


def test_Kling은_가짜로_만들어두지_않았다() -> None:
    """§0-2 — 계정 확인이 끝나야 붙입니다. 되는 척하지 않습니다."""
    db = Database(Path(tempfile.mkdtemp()) / "t.sqlite3")
    r = ProviderRegistry(db)
    assert r.chosen("video") == "kling"
    try:
        r.video_provider()
    except NotBuiltYet as e:
        assert "확인" in e.user_message
    else:
        raise AssertionError("없는 Kling 이 만들어졌습니다")


def test_사진_움직이기는_그대로_된다() -> None:
    """Stage 6b 를 건드리지 않았는지 봅니다."""
    db = Database(Path(tempfile.mkdtemp()) / "t.sqlite3")
    p = ProviderRegistry(db).photo_video_provider()
    assert isinstance(p, KenBurnsProvider)
    assert isinstance(p, VideoProvider)
    assert p.estimate.__self__ is p


# ═════════════════════════════════════════════════════════
# 기본 공급자와 보안
# ═════════════════════════════════════════════════════════


def test_기본_공급자가_지시서대로다() -> None:
    db = Database(Path(tempfile.mkdtemp()) / "t.sqlite3")
    r = ProviderRegistry(db)
    assert r.chosen("script") == "openai"
    assert r.chosen("image") == "openai"
    assert r.chosen("voice") == "elevenlabs"
    assert r.chosen("video") == "kling"


def test_예전_Claude_대본도_남아_있다() -> None:
    """기존 기능을 지우지 않았습니다."""
    db = Database(Path(tempfile.mkdtemp()) / "t.sqlite3")
    r = ProviderRegistry(db)
    r.choose("script", "claude")
    from app.providers.llm_claude import ClaudeScriptProvider
    try:
        p = r.script_provider()
    except ProviderError:
        return          # 열쇠가 없어 못 만드는 건 정상입니다
    assert isinstance(p, ClaudeScriptProvider)


def test_열쇠가_오류_글에_새지_않는다() -> None:
    """§0-3 — 로그·오류 어디에도 열쇠가 나오면 안 됩니다."""
    새는답 = HttpResponse(
        401, json.dumps({"error": {
            "message": f"Incorrect API key provided: {KEY.reveal()}"}}).encode())
    masking.register(KEY.reveal())
    p = OpenAIScriptProvider(api_key=KEY, http=FakeHttp(새는답), model="가상모델-A")
    try:
        p.list_models()
    except ProviderError as e:
        assert KEY.reveal() not in e.log_detail, "기록에 열쇠가 남았습니다"
        assert "REALSECRETVALUE" not in e.log_detail
        assert KEY.reveal() not in e.user_message
        assert "★" in e.log_detail
    else:
        raise AssertionError("401 인데 그냥 넘어갔습니다")


def test_열쇠가_화면_글에_안_나온다() -> None:
    for 상태, 나와야할말 in ((401, "회사에 문의"), (429, "잠시 뒤"), (500, "잠시 뒤")):
        p = OpenAIScriptProvider(api_key=KEY, http=FakeHttp(_bad(상태)),
                                 model="가상모델-A")
        try:
            p.list_models()
        except ProviderError as e:
            assert 나와야할말 in e.user_message, (상태, e.user_message)
            for 금지 in ("sk-", "HTTP", "Traceback", str(상태)):
                assert 금지 not in e.user_message, (상태, 금지, e.user_message)


def test_인터넷이_없으면_다시_해보라고_한다() -> None:
    for p in (OpenAIScriptProvider(api_key=KEY, http=DeadHttp(), model="m"),
              OpenAIImageProvider(api_key=KEY, http=DeadHttp(), model="m"),
              ElevenLabsTTSProvider(api_key=KEY, http=DeadHttp(), model="m",
                                    voice_id="v")):
        try:
            p.list_models()
        except ProviderError as e:
            assert e.retry is Retry.BACKOFF
            assert "인터넷" in e.user_message
        else:
            raise AssertionError(f"{p.name}: 인터넷이 없는데 넘어갔습니다")


def test_윈도우가_아니어도_불러올_수_있다() -> None:
    """지시서: 「비Windows 환경에서 import 단계에서 죽으면 안 된다」."""
    import importlib
    for 이름 in ("app.providers.llm_openai", "app.providers.image_openai",
               "app.providers.tts_elevenlabs", "app.services.registry",
               "app.services.pipeline", "app.services.rules_service",
               "app.services.research", "app.core.http", "app.core.rules"):
        assert importlib.import_module(이름) is not None, 이름
    # 열쇠 없이 만들어도 죽지 않습니다 (부를 때 멈춥니다)
    assert OpenAIScriptProvider().name == "openai"


def test_공급자에_지우는_코드가_없다() -> None:
    바탕 = Path(__file__).resolve().parent.parent
    for 이름 in ("providers/llm_openai.py", "providers/image_openai.py",
               "providers/tts_elevenlabs.py", "services/registry.py",
               "services/research.py", "core/http.py", "core/rules.py"):
        글 = (바탕 / "app" / 이름).read_text(encoding="utf-8")
        for 금지 in ("rmtree", "os.remove", "rm -rf", "shutil.move"):
            assert 금지 not in 글, f"{이름} 에 {금지} 가 있습니다"


def test_참고_주소를_프로그램이_열지_않는다() -> None:
    """§0-4 — 저장만 합니다."""
    from app.services.research import CompetitorAnalysisService
    db = Database(Path(tempfile.mkdtemp()) / "t.sqlite3")
    svc = CompetitorAnalysisService(db)
    svc.add("instagram", url="https://example.invalid/p/AAA", note="첫 3초가 좋다")
    글 = svc.summary_for_prompt()
    assert "첫 3초가 좋다" in 글
    assert "example.invalid" not in 글, "주소가 프롬프트로 넘어갑니다"
    바탕 = Path(__file__).resolve().parent.parent / "app" / "services" / "research.py"
    본문 = 바탕.read_text(encoding="utf-8")
    for 금지 in ("requests.get", "urlopen", "webbrowser", "selenium",
               "playwright", "BeautifulSoup"):
        assert 금지 not in 본문, f"자동 수집 코드가 있습니다: {금지}"


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
