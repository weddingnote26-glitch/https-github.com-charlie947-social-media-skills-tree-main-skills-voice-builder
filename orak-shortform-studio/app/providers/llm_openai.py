"""대본 만들기 — OpenAI (2026-08-29 지시로 기본 공급자가 되었습니다).

**모델 이름을 코드에 박아두지 않았습니다.** 지시서 §0-2 가 「API endpoint와
모델명을 추측하지 마세요 · 확인이 안 되면 가짜로 코딩하지 말고 멈추고
물어보세요」 라고 했고, 이번 지시서도 「모델명을 코드 여러 군데에
하드코딩하지 말고 설정값으로 관리한다」 고 했습니다.

그래서 이렇게 합니다.

    [연결 테스트] → GET /v1/models → **계정이 실제로 쓸 수 있는 목록**
    → 담당자가 그 중에서 고름 → settings 에 저장 → 여기서 씀

추측한 이름이 코드에 남지 않습니다. 안 고르면 부르지 않고 멈춥니다.

기존 `llm_claude.py` 는 **지우지 않았습니다.** 공급자를 바꿔 끼울 수 있게
둘 다 같은 `ScriptProvider` 계약을 지킵니다.
"""

from __future__ import annotations

import json
from typing import Any, Optional, Sequence

from app.contracts.errors import ProviderError, Retry, SecretStr
from app.contracts.models import CostEstimate, Scene, Script, StoreInfo
from app.core import masking
from app.core.http import DEFAULT_TIMEOUT, HttpClient, HttpError, RequestsHttp
from app.core.script_rules import Problem, check_script
from app.providers.script_spec import (
    SCRIPT_SCHEMA,
    build_system_prompt,
    build_user_prompt,
    retry_prompt,
    strict_schema,
    to_script,
)

BASE_URL = "https://api.openai.com/v1"
"""공식 주소. 다른 곳을 쓰면 설정에서 바꿉니다 — 코드를 고치지 않습니다."""

MODEL_SETTING_KEY = "openai.script_model"
"""settings 표에 저장되는 이름. 여기 한 군데서만 정합니다."""

MAX_REGENERATE = 2
"""§6 — 형식을 벗어나면 최대 2번까지 다시 시킵니다."""

MAX_TOKENS = 16000

# 대본의 모양과 §6 규칙은 `script_spec.py` 에 있습니다. Claude 판과 **같은 것**을
# 씁니다 — 한쪽만 낡으면 두 공급자가 다른 대본을 만들게 됩니다.
_SCHEMA = strict_schema(SCRIPT_SCHEMA)
"""OpenAI 엄격 모드가 `minItems`/`maxItems` 를 받지 않아 걷어낸 판."""


class OpenAIScriptProvider:
    """`ScriptProvider` 계약을 지킵니다 (`app/contracts/providers.py`).

    `http` 를 주면 그걸 씁니다. 시험은 가짜를 넣어 **진짜로 부르지 않고**
    흐름을 확인합니다.
    """

    name = "openai"

    def __init__(self, *, api_key: Optional[SecretStr] = None,
                 http: Optional[HttpClient] = None,
                 model: str = "",
                 base_url: str = BASE_URL,
                 max_kling_clips: int = 2,
                 pricing: Optional[dict[str, float]] = None,
                 timeout: float = DEFAULT_TIMEOUT) -> None:
        self.model = (model or "").strip()
        self.base_url = base_url.rstrip("/")
        self.max_kling_clips = max_kling_clips
        self._pricing = pricing or {}
        self._timeout = timeout
        self._http = http or RequestsHttp()
        self._key = api_key
        if api_key is not None:
            masking.register(api_key.reveal())

    # ── 부르기 전 검사 ────────────────────────────────────
    def _require_key(self) -> str:
        if self._key is None:
            raise ProviderError(
                retry=Retry.NEVER_AUTH,
                user_message="대본을 만들 열쇠가 없습니다. 설정에서 넣어주세요.",
                log_detail="openai api key missing", provider=self.name)
        return self._key.reveal()

    def _require_model(self) -> str:
        """**모델을 안 고르면 부르지 않습니다.** 추측한 이름을 쓰지 않습니다 (§0-2)."""
        if not self.model:
            raise ProviderError(
                retry=Retry.NEVER_PARAM,
                user_message="대본 모델을 아직 고르지 않았습니다. "
                             "설정에서 [연결 테스트] 를 누른 뒤 목록에서 골라주세요.",
                log_detail="openai script model not configured",
                provider=self.name)
        return self.model

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._require_key()}",
                "Content-Type": "application/json"}

    # ── 연결 확인 ─────────────────────────────────────────
    def list_models(self) -> list[tuple[str, str]]:
        """이 열쇠로 **실제로 쓸 수 있는** 모델 목록.

        추측하지 않고 계정에 물어봅니다. 설정 화면이 이걸로 목록을 채웁니다.
        """
        try:
            r = self._http.request("GET", f"{self.base_url}/models",
                                   headers=self._headers(), timeout=self._timeout)
        except HttpError as exc:
            raise self._friendly(exc) from None
        if not r.ok:
            raise self._from_status(r.status, r.text)
        자료 = r.json() or {}
        목록 = 자료.get("data") or []
        이름들 = sorted({str(m.get("id", "")) for m in 목록 if m.get("id")})
        return [(n, n) for n in 이름들]

    def health(self) -> tuple[bool, str]:
        try:
            목록 = self.list_models()
        except ProviderError as e:
            return False, e.user_message
        if not 목록:
            return False, "연결은 됐지만 쓸 수 있는 모델이 없습니다. 결제 상태를 확인해 주세요."
        if not self.model:
            return True, f"연결됐습니다. 모델 {len(목록)}개 중에서 골라주세요."
        if self.model not in {m for m, _ in 목록}:
            return False, (f"고른 모델「{self.model}」을 이 열쇠로 쓸 수 없습니다. "
                           "목록에서 다시 골라주세요.")
        return True, f"대본 만들기를 쓸 수 있습니다. (모델 {self.model})"

    # ── 비용 ──────────────────────────────────────────────
    def estimate(self, store: StoreInfo, scene_count: int) -> CostEstimate:
        rate = self._pricing.get("환율", 1380.0)
        in_usd = self._pricing.get("입력_백만당_달러")
        out_usd = self._pricing.get("출력_백만당_달러")
        if in_usd is None or out_usd is None:
            # 요금을 모르면 **0원이라고 말하지 않습니다.** 모른다고 말합니다 (§9).
            return CostEstimate(krw=0, breakdown=(("대본", 0),), is_complete=False)
        krw = round((1500 / 1_000_000 * in_usd + 2500 / 1_000_000 * out_usd) * rate)
        return CostEstimate(krw=krw, breakdown=(("대본", krw),))

    # ── 만들기 ────────────────────────────────────────────
    def generate(self, store: StoreInfo, scene_count: int,
                 extra_prompt: str = "") -> Script:
        """대본 한 벌. 형식을 벗어나면 최대 2번 다시 시킵니다 (§6).

        Args:
            extra_prompt: 「기본 제작 필수 규칙」 이 조립해 넘겨준 글.
                `app/services/prompt_builder.py` 참고.
        """
        system = build_system_prompt(max_kling_clips=self.max_kling_clips)
        처음요청 = build_user_prompt(store, scene_count, extra_prompt)
        user = 처음요청
        남은문제: list[Problem] = []

        for 회차 in range(MAX_REGENERATE + 1):
            자료 = self._ask(system, user)
            # **바꾸기 전 원본을 봅니다.** `Script` 로 바꾼 뒤에는
            # 어느 칸이 잘못됐는지 짚어 주기 어렵습니다.
            남은문제 = check_script(
                자료, is_paid_promotion=store.disclosure.is_paid,
                max_kling_clips=self.max_kling_clips)
            if not 남은문제:
                return self._to_script(자료)
            if 회차 == MAX_REGENERATE:
                break
            user = f"{처음요청}\n\n{retry_prompt(남은문제)}"

        raise ProviderError(
            retry=Retry.MANUAL,
            user_message="대본이 규칙에 맞지 않습니다. 입력한 내용을 조금 바꿔 다시 해주세요.",
            log_detail="; ".join(f"{p.where}:{p.message}" for p in 남은문제),
            provider=self.name)

    def _ask(self, system: str, user: str) -> dict[str, Any]:
        몸통 = {
            "model": self._require_model(),
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "max_completion_tokens": MAX_TOKENS,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "script", "strict": True,
                                "schema": _SCHEMA},
            },
        }
        try:
            r = self._http.request("POST", f"{self.base_url}/chat/completions",
                                   headers=self._headers(), json=몸통,
                                   timeout=self._timeout)
        except HttpError as exc:
            raise self._friendly(exc) from None
        if not r.ok:
            raise self._from_status(r.status, r.text)

        답 = r.json() or {}
        try:
            글 = 답["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise ProviderError(
                retry=Retry.MANUAL,
                user_message="대본을 만들지 못했습니다. 다시 시도해 주세요.",
                log_detail=masking.scrub(f"unexpected shape: {r.text[:400]}"),
                provider=self.name) from None
        try:
            return json.loads(글)
        except (ValueError, TypeError):
            raise ProviderError(
                retry=Retry.MANUAL,
                user_message="대본을 만들지 못했습니다. 다시 시도해 주세요.",
                log_detail=masking.scrub(f"not json: {str(글)[:400]}"),
                provider=self.name) from None

    def _to_script(self, data: dict[str, Any]) -> Script:
        return to_script(data)

    # ── 오류 번역 ─────────────────────────────────────────
    def _from_status(self, status: int, text: str) -> ProviderError:
        detail = masking.scrub(text[:600])
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
        if status == 404:
            return ProviderError(
                retry=Retry.NEVER_PARAM,
                user_message="고른 모델을 찾을 수 없습니다. 설정에서 다시 골라주세요.",
                log_detail=detail, provider=self.name, vendor_code="404")
        if status == 429:
            return ProviderError(
                retry=Retry.BACKOFF, user_message="잠시 뒤에 다시 시도합니다.",
                log_detail=detail, provider=self.name, vendor_code="429")
        if status >= 500:
            return ProviderError(
                retry=Retry.BACKOFF, user_message="잠시 뒤에 다시 시도합니다.",
                log_detail=detail, provider=self.name, vendor_code=str(status))
        return ProviderError(
            retry=Retry.MANUAL,
            user_message="대본을 만들지 못했습니다. 다시 시도해 주세요.",
            log_detail=detail, provider=self.name, vendor_code=str(status))

    def _friendly(self, exc: Exception) -> ProviderError:
        return ProviderError(
            retry=Retry.BACKOFF,
            user_message="인터넷 연결을 확인한 뒤 다시 눌러 주세요.",
            log_detail=masking.scrub(f"{type(exc).__name__}: {exc}"),
            provider=self.name)
