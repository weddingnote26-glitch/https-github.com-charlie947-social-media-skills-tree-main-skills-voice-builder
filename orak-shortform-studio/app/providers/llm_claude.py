"""대본 생성 — Anthropic Claude (지시서 §6 · §2-4).

**모델 이름을 코드에 박지 않습니다.** 기본값만 두고 Settings 에서 바꿉니다 (§2-4).
카드뉴스 도구와 **다른 API 키**를 씁니다. 비용을 나눠서 봐야 합니다.

세 겹으로 대본을 지킵니다.

1. **구조화 출력** — JSON 모양은 서버가 보장합니다. 형식이 깨질 일이 없습니다.
2. **규칙 검사** — 글자 수·금지 표현·30초·클립 수는 스키마로 표현할 수 없으므로
   ``app/core/script_rules.py`` 가 검사하고, 어기면 **최대 2회 다시 만듭니다** (§6).
3. **광고 표시 강제** — 만든 뒤 무조건 ``ensure_ad_prefix()`` 를 거칩니다 (§5).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional, Protocol

from app.contracts.errors import ProviderError, Retry, SecretStr
from app.contracts.models import (
    KOREAN_CHARS_PER_SEC,
    MAX_TOTAL_SEC,
    SCENE_COUNT_DEFAULT,
    SCENE_COUNT_MAX,
    SCENE_COUNT_MIN,
    SUBTITLE_MAX_CHARS_PER_LINE,
    CostEstimate,
    RenderMode,
    Scene,
    Script,
    StoreInfo,
)
from app.core import masking
from app.core.script_rules import Problem, check_script, ensure_ad_prefix

DEFAULT_MODEL = "claude-opus-5"
"""기본 모델. Settings 에서 바꿀 수 있습니다 (§2-4).

카드뉴스 도구(A)도 같은 모델을 쓰지만 **키는 서로 다릅니다** (분리규칙 §3-5).
"""

MAX_REGENERATE = 2
"""규칙을 어겼을 때 다시 만드는 횟수 (§6). 이보다 많이 하면 비용만 나갑니다."""

MAX_TOKENS = 16000

# ─────────────────────────────────────────────────────────────
# JSON 스키마 — 서버가 이 모양을 보장합니다
# ─────────────────────────────────────────────────────────────

SCENE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "idx": {"type": "integer", "description": "1부터 시작하는 장면 번호"},
        "start_sec": {"type": "number"},
        "end_sec": {"type": "number"},
        "render_mode": {
            "type": "string",
            "enum": [RenderMode.KLING.value, RenderMode.KENBURNS.value,
                     RenderMode.STILL.value],
            "description": "오락이가 나오면 kling, 실제 음식·매장 사진이면 kenburns",
        },
        "narration": {"type": "string", "description": "읽어줄 말 (한국어)"},
        "screen_text": {"type": "string", "description": "화면 자막. 한 줄 16자 이하, 최대 2줄"},
        "image_prompt": {"type": "string", "description": "장면 이미지를 만들 영어 지시문"},
        "video_prompt": {"type": "string", "description": "움직임을 설명하는 영어 지시문. kling 장면만"},
    },
    "required": ["idx", "start_sec", "end_sec", "render_mode", "narration",
                 "screen_text", "image_prompt", "video_prompt"],
    "additionalProperties": False,
}

SCRIPT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "hook": {"type": "string", "description": "첫 3초를 붙잡는 한 문장"},
        "full_text": {"type": "string", "description": "전체 대본을 이어 쓴 것"},
        "scenes": {"type": "array", "items": SCENE_SCHEMA,
                   "minItems": SCENE_COUNT_MIN, "maxItems": SCENE_COUNT_MAX},
        "title": {"type": "string"},
        "caption": {"type": "string", "description": "인스타그램 게시글 설명"},
        "hashtags": {"type": "array", "items": {"type": "string"},
                     "minItems": 5, "maxItems": 12},
    },
    "required": ["hook", "full_text", "scenes", "title", "caption", "hashtags"],
    "additionalProperties": False,
}


# ─────────────────────────────────────────────────────────────
# 프롬프트
# ─────────────────────────────────────────────────────────────

def build_system_prompt(*, max_kling_clips: int = 2) -> str:
    """맛집마다 바뀌지 않는 부분. **캐시가 걸리는 곳입니다.**

    가게 정보처럼 매번 바뀌는 것을 여기 섞으면 캐시가 깨져 비용이 올라갑니다.
    """
    return f"""당신은 「동네친구 오락 — 만두탐정 오락이」 인스타그램 릴스의 대본을 씁니다.
관악구(신림·봉천·서울대입구) 맛집을 소개하는 세로 영상이며, 주 시청자는 50~70대입니다.

## 만들 것
장면 {SCENE_COUNT_MIN}~{SCENE_COUNT_MAX}개(기본 {SCENE_COUNT_DEFAULT}개)로 이루어진 대본 한 편.

## 반드시 지킬 것

길이
- 전체 {MAX_TOTAL_SEC:g}초를 넘기지 마세요. 넘으면 영상을 만들 수 없습니다.
- 장면 시간은 빈틈없이 이어져야 합니다. 앞 장면의 end_sec 이 다음 장면의 start_sec 입니다.
- 읽어줄 말은 그 장면 시간 안에 읽을 수 있어야 합니다.
  한국어는 초당 약 {KOREAN_CHARS_PER_SEC[0]:g}~{KOREAN_CHARS_PER_SEC[1]:g}자입니다.
  3초 장면이면 공백 빼고 18자를 넘기지 마세요.

자막 (화면에 뜨는 글)
- 한 줄 {SUBTITLE_MAX_CHARS_PER_LINE}자 이하, 최대 2줄.
- 짧은 문장으로. 접속사로 길게 잇지 마세요.
- 50~70대가 읽습니다. 어려운 말과 영어를 쓰지 마세요.

장면을 만드는 방식 (render_mode)
- 오락이(만두탐정 캐릭터)가 나오는 장면 → "kling"
- 실제 음식·매장 사진을 쓰는 장면 → "kenburns"
- **kling 장면은 최대 {max_kling_clips}개입니다.** 비용의 대부분이 여기서 나옵니다.
- kling 장면은 처음(사건 제시)과 중간(직접 먹어보고 반응)에 두는 것이 좋습니다.
- 화면 비중은 오락이 40% / 음식·매장 60% 정도로 잡으세요.

쓰면 안 되는 표현
- 최고, 1등, 무조건, 대박, 역대급, 여기 아니면 없는, 완벽, 100%
- 근거 없는 최상급은 부당 표시광고가 될 수 있습니다.
- 확인되지 않은 정보를 지어내지 마세요. 주어진 정보만 쓰세요.

말투
- 동네 친구가 알려주는 말투. 가르치려 들지 마세요.
- 불안을 부추기지 마세요. 이모지를 쓰지 마세요.

## image_prompt 와 video_prompt (영어로 쓰세요)
- image_prompt: 그 장면의 그림을 설명합니다. 오락이 장면이면 표정·동작·배경만 쓰고,
  **캐릭터 생김새는 쓰지 마세요.** 생김새는 프로그램이 따로 붙입니다.
- video_prompt: 어떻게 움직이는지만 짧게. kenburns 장면은 빈 문자열로 두세요.
- 배경에 실제 상호명·간판 글씨·실존 인물·브랜드 로고가 들어가지 않게 하세요."""


def build_user_prompt(store: StoreInfo, scene_count: int) -> str:
    """맛집마다 바뀌는 부분. **캐시 뒤에 옵니다.**"""
    lines = [
        f"장면 {scene_count}개로 만들어 주세요.",
        "",
        "## 맛집 정보",
        f"- 매장명: {store.store_name}",
        f"- 지역: {store.area}",
        f"- 주소: {store.address}",
        f"- 대표메뉴: {store.menu}",
        f"- 가격: {store.price}",
        f"- 특징: {store.features}",
        f"- 추천 이유: {store.reason}",
    ]
    if store.memo:
        lines.append(f"- 메모: {store.memo}")
    if store.photo_paths:
        lines.append(f"- 담당자가 준비한 실제 사진: {len(store.photo_paths)}장 "
                     "(이 장수만큼은 kenburns 장면으로 쓸 수 있습니다)")
    if store.disclosure.is_paid:
        lines += [
            "",
            "## 광고 표시",
            "이 매장에서 대가나 협찬을 받았습니다.",
            "게시글 설명(caption) 맨 앞 줄에 「유료광고 포함」을 넣어주세요.",
        ]
    lines += [
        "",
        "위 정보에 없는 것은 지어내지 마세요.",
        "특히 영업시간·휴무일·주차 여부는 알 수 없으므로 쓰지 마세요.",
    ]
    return "\n".join(lines)


def _retry_prompt(problems: list[Problem]) -> str:
    항목 = "\n".join(
        f"- {p.where}: {p.message}" + (f" ({p.fix})" if p.fix else "")
        for p in problems)
    return ("방금 만든 대본이 규칙을 어겼습니다. 아래를 고쳐서 다시 만들어 주세요.\n\n"
            f"{항목}\n\n"
            "고칠 부분만 손보고 나머지는 그대로 두세요.")


# ─────────────────────────────────────────────────────────────
# 공급자
# ─────────────────────────────────────────────────────────────


class _MessagesLike(Protocol):
    def create(self, **kwargs: Any) -> Any: ...


class _ClientLike(Protocol):
    messages: _MessagesLike


@dataclass
class ScriptResult:
    """만든 대본과, 만드는 데 실제로 든 것."""

    script: Script
    raw: dict[str, Any]
    attempts: int
    input_tokens: int
    output_tokens: int
    cached_tokens: int
    remaining_problems: list[Problem]


class ClaudeScriptProvider:
    """``ScriptProvider`` 계약을 지킵니다 (``app/contracts/providers.py``).

    ``client`` 를 주면 그걸 씁니다. 안 주면 열쇠로 만듭니다.
    시험은 가짜 client 를 넣어 API 를 부르지 않고 흐름을 확인합니다.
    """

    name = "claude"

    def __init__(self, *, api_key: Optional[SecretStr] = None,
                 client: Optional[_ClientLike] = None,
                 model: str = DEFAULT_MODEL,
                 max_kling_clips: int = 2,
                 pricing: Optional[dict[str, float]] = None) -> None:
        self.model = model
        self.max_kling_clips = max_kling_clips
        self._pricing = pricing or {}
        if client is not None:
            self._client = client
        else:
            if api_key is None:
                raise ProviderError(
                    retry=Retry.NEVER_AUTH,
                    user_message="대본을 만들 열쇠가 없습니다. 설정에서 넣어주세요.",
                    log_detail="claude api key missing",
                    provider=self.name)
            import anthropic

            masking.register(api_key.reveal())
            self._client = anthropic.Anthropic(api_key=api_key.reveal())

    # ── 연결 확인 ─────────────────────────────────────────
    def health(self) -> tuple[bool, str]:
        try:
            self._client.messages.create(
                model=self.model, max_tokens=16,
                messages=[{"role": "user", "content": "안녕하세요"}])
        except Exception as exc:
            return False, self._friendly(exc).user_message
        return True, "대본 만들기를 쓸 수 있습니다."

    # ── 비용 ──────────────────────────────────────────────
    def estimate(self, store: StoreInfo, scene_count: int) -> CostEstimate:
        """부르기 전에 원화로 보여줄 값 (§9 · §11)."""
        rate = self._pricing.get("환율", 1380.0)
        in_usd = self._pricing.get("입력_백만당_달러")
        out_usd = self._pricing.get("출력_백만당_달러")
        if in_usd is None or out_usd is None:
            return CostEstimate(krw=0, breakdown=(("대본", 0),), is_complete=False)

        # 어림: 시스템 프롬프트 + 가게 정보 ≈ 1,500 토큰, 답 ≈ 2,500 토큰
        krw = round((1500 / 1_000_000 * in_usd + 2500 / 1_000_000 * out_usd) * rate)
        return CostEstimate(krw=krw, breakdown=(("대본", krw),))

    def cost_krw(self, input_tokens: int, output_tokens: int) -> int:
        """실제로 쓴 토큰으로 계산합니다. ``generation_jobs`` 에 적습니다 (§11)."""
        rate = self._pricing.get("환율", 1380.0)
        in_usd = self._pricing.get("입력_백만당_달러")
        out_usd = self._pricing.get("출력_백만당_달러")
        if in_usd is None or out_usd is None:
            return 0
        return round((input_tokens / 1_000_000 * in_usd
                      + output_tokens / 1_000_000 * out_usd) * rate)

    # ── 만들기 ────────────────────────────────────────────
    def generate(self, store: StoreInfo,
                 scene_count: int = SCENE_COUNT_DEFAULT) -> Script:
        return self.generate_detailed(store, scene_count).script

    def generate_detailed(self, store: StoreInfo,
                          scene_count: int = SCENE_COUNT_DEFAULT) -> ScriptResult:
        system = build_system_prompt(max_kling_clips=self.max_kling_clips)
        messages: list[dict[str, Any]] = [
            {"role": "user", "content": build_user_prompt(store, scene_count)}]

        in_tok = out_tok = cached = 0
        last_problems: list[Problem] = []
        data: dict[str, Any] = {}

        for attempt in range(1, MAX_REGENERATE + 2):     # 처음 1회 + 재생성 2회
            data, usage = self._ask(system, messages)
            in_tok += usage[0]
            out_tok += usage[1]
            cached += usage[2]

            data["caption"] = ensure_ad_prefix(
                data.get("caption", ""),
                is_paid_promotion=store.disclosure.is_paid)

            last_problems = check_script(
                data, is_paid_promotion=store.disclosure.is_paid,
                max_kling_clips=self.max_kling_clips)
            if not last_problems:
                break
            if attempt > MAX_REGENERATE:
                break
            messages += [
                {"role": "assistant", "content": json.dumps(data, ensure_ascii=False)},
                {"role": "user", "content": _retry_prompt(last_problems)},
            ]

        return ScriptResult(
            script=self._to_script(data),
            raw=data,
            attempts=attempt,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cached_tokens=cached,
            remaining_problems=last_problems,
        )

    # ── 속 ────────────────────────────────────────────────
    def _ask(self, system: str,
             messages: list[dict[str, Any]]) -> tuple[dict[str, Any], tuple[int, int, int]]:
        try:
            resp = self._client.messages.create(
                model=self.model,
                max_tokens=MAX_TOKENS,
                # 바뀌지 않는 부분에 캐시를 겁니다. 재생성할 때 값이 큽니다.
                system=[{"type": "text", "text": system,
                         "cache_control": {"type": "ephemeral"}}],
                messages=messages,
                thinking={"type": "adaptive"},
                output_config={"format": {"type": "json_schema",
                                          "schema": SCRIPT_SCHEMA}},
            )
        except Exception as exc:
            raise self._friendly(exc) from None

        text = next((b.text for b in resp.content
                     if getattr(b, "type", "") == "text"), "")
        if not text:
            raise ProviderError(
                retry=Retry.MANUAL,
                user_message="대본을 만들지 못했습니다. 다시 시도해 주세요.",
                log_detail="empty text block in response",
                provider=self.name)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ProviderError(
                retry=Retry.MANUAL,
                user_message="대본을 만들지 못했습니다. 다시 시도해 주세요.",
                log_detail=f"json decode failed: {exc}",
                provider=self.name) from None

        u = getattr(resp, "usage", None)
        usage = (getattr(u, "input_tokens", 0) or 0,
                 getattr(u, "output_tokens", 0) or 0,
                 getattr(u, "cache_read_input_tokens", 0) or 0)
        return data, usage

    def _to_script(self, data: dict[str, Any]) -> Script:
        scenes = [
            Scene(
                idx=int(s["idx"]),
                start_sec=float(s["start_sec"]),
                end_sec=float(s["end_sec"]),
                render_mode=RenderMode(s["render_mode"]),
                narration=s.get("narration", ""),
                screen_text=s.get("screen_text", ""),
                image_prompt=s.get("image_prompt", ""),
                video_prompt=s.get("video_prompt", ""),
            )
            for s in data.get("scenes", [])
        ]
        return Script(
            hook=data.get("hook", ""),
            full_text=data.get("full_text", ""),
            scenes=scenes,
            title=data.get("title", ""),
            caption=data.get("caption", ""),
            hashtags=tuple(data.get("hashtags", [])),
        )

    def _friendly(self, exc: Exception) -> ProviderError:
        """벤더 오류를 담당자에게 보여줄 한국어로 바꿉니다 (§9 · §2-1 표 형식)."""
        status = getattr(exc, "status_code", None)
        detail = masking.scrub(f"{type(exc).__name__}: {exc}")

        if status in (401, 403):
            return ProviderError(
                retry=Retry.NEVER_AUTH,
                user_message="사용 키에 문제가 있습니다. 회사에 문의해 주세요.",
                log_detail=detail, provider=self.name, vendor_code=str(status))
        if status == 400:
            return ProviderError(
                retry=Retry.NEVER_PARAM,
                user_message="대본을 만들 수 없습니다. 입력한 내용을 확인해 주세요.",
                log_detail=detail, provider=self.name, vendor_code="400")
        if status == 429:
            return ProviderError(
                retry=Retry.BACKOFF,
                user_message="잠시 뒤에 다시 시도합니다.",
                log_detail=detail, provider=self.name, vendor_code="429")
        if status and status >= 500:
            return ProviderError(
                retry=Retry.BACKOFF,
                user_message="잠시 뒤에 다시 시도합니다.",
                log_detail=detail, provider=self.name, vendor_code=str(status))
        if "APIConnectionError" in type(exc).__name__ or "Timeout" in type(exc).__name__:
            return ProviderError(
                retry=Retry.BACKOFF,
                user_message="인터넷 연결을 확인한 뒤 다시 눌러 주세요.",
                log_detail=detail, provider=self.name)
        return ProviderError(
            retry=Retry.MANUAL,
            user_message="대본을 만들지 못했습니다. 다시 시도해 주세요.",
            log_detail=detail, provider=self.name)
