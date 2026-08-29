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

# 대본의 모양과 §6 규칙은 **공급자와 무관**합니다. OpenAI 를 붙이면서
# `script_spec.py` 한 곳으로 옮겼습니다. 여기서는 그대로 다시 내보냅니다 —
# 이 이름들을 쓰던 곳(시험 포함)이 그대로 돌아가게 하려는 것입니다.
from app.providers.script_spec import (  # noqa: F401,E402
    SCENE_SCHEMA,
    SCRIPT_SCHEMA,
    build_system_prompt,
    build_user_prompt,
    retry_prompt,
    to_script,
)


def _retry_prompt(problems: list[Problem]) -> str:
    return retry_prompt(problems)



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
        return to_script(data)

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
