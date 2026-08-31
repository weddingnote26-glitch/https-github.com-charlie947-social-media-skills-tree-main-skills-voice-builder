"""이미지 만들기 — OpenAI (2026-08-29 지시로 기본 공급자가 되었습니다).

`llm_openai.py` 와 같은 원칙입니다. **모델 이름을 박아두지 않습니다** (§0-2).
[연결 테스트] 가 계정에 물어본 목록에서 담당자가 고르고, 그 값이 설정에 남습니다.

⚠️ **장당 요금은 아직 확인되지 않았습니다.** `assets/pricing.json` 의 값이
`null` 이면 `estimate()` 는 「모른다」(`is_complete=False`)고 답하고,
비용 게이트가 진행을 막습니다. **0원이라고 거짓말하지 않습니다** (§9).
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Optional, Sequence

from app.contracts.errors import ProviderError, Retry, SecretStr
from app.contracts.models import CostEstimate, VIDEO_HEIGHT, VIDEO_WIDTH
from app.core import masking
from app.core.http import DEFAULT_TIMEOUT, HttpClient, HttpError, RequestsHttp

BASE_URL = "https://api.openai.com/v1"
MODEL_SETTING_KEY = "openai.image_model"

SIZE = f"{VIDEO_WIDTH}x{VIDEO_HEIGHT}"
"""세로 1080x1920. 공급자가 이 크기를 못 받으면 [연결 테스트] 에서 걸립니다."""


class OpenAIImageProvider:
    """`ImageProvider` 계약을 지킵니다 (`app/contracts/providers.py`)."""

    name = "openai-image"

    def __init__(self, *, api_key: Optional[SecretStr] = None,
                 http: Optional[HttpClient] = None,
                 model: str = "",
                 base_url: str = BASE_URL,
                 pricing: Optional[dict[str, Any]] = None,
                 timeout: float = DEFAULT_TIMEOUT) -> None:
        self.model = (model or "").strip()
        self.base_url = base_url.rstrip("/")
        self._pricing = pricing or {}
        self._timeout = timeout
        self._http = http or RequestsHttp()
        self._key = api_key
        if api_key is not None:
            masking.register(api_key.reveal())

    def _headers(self) -> dict[str, str]:
        if self._key is None:
            raise ProviderError(
                retry=Retry.NEVER_AUTH,
                user_message="이미지를 만들 열쇠가 없습니다. 설정에서 넣어주세요.",
                log_detail="openai image key missing", provider=self.name)
        return {"Authorization": f"Bearer {self._key.reveal()}",
                "Content-Type": "application/json"}

    def _require_model(self) -> str:
        if not self.model:
            raise ProviderError(
                retry=Retry.NEVER_PARAM,
                user_message="이미지 모델을 아직 고르지 않았습니다. "
                             "설정에서 [연결 테스트] 를 누른 뒤 목록에서 골라주세요.",
                log_detail="openai image model not configured", provider=self.name)
        return self.model

    # ── 연결 확인 ─────────────────────────────────────────
    def list_models(self) -> list[tuple[str, str]]:
        try:
            r = self._http.request("GET", f"{self.base_url}/models",
                                   headers=self._headers(), timeout=self._timeout)
        except HttpError as exc:
            raise self._friendly(exc) from None
        if not r.ok:
            raise self._from_status(r.status, r.text)
        이름들 = sorted({str(m.get("id", ""))
                       for m in ((r.json() or {}).get("data") or []) if m.get("id")})
        return [(n, n) for n in 이름들]

    def health(self) -> tuple[bool, str]:
        try:
            목록 = self.list_models()
        except ProviderError as e:
            return False, e.user_message
        if not self.model:
            return True, f"연결됐습니다. 모델 {len(목록)}개 중에서 골라주세요."
        if self.model not in {m for m, _ in 목록}:
            return False, (f"고른 모델「{self.model}」을 이 열쇠로 쓸 수 없습니다. "
                           "목록에서 다시 골라주세요.")
        return True, f"이미지 만들기를 쓸 수 있습니다. (모델 {self.model})"

    # ── 비용 ──────────────────────────────────────────────
    def estimate(self, count: int) -> CostEstimate:
        장당 = self._pricing.get("장당_달러")
        rate = self._pricing.get("환율", 1380.0)
        if 장당 is None:
            # **모르면 모른다고 합니다.** 0원이라고 하면 한도 계산이 무너집니다.
            return CostEstimate(krw=0, breakdown=(("이미지", 0),), is_complete=False)
        krw = round(장당 * rate * max(count, 0))
        return CostEstimate(krw=krw, breakdown=(("이미지", krw),))

    # ── 만들기 ────────────────────────────────────────────
    def generate_scene_image(self, *, prompt: str,
                             character_refs: Sequence[Path] = (),
                             negative_prompt: str = "",
                             dest: Path) -> Path:
        """장면 이미지 한 장을 만들어 파일로 저장합니다.

        `character_refs` 는 오락이 마스터 이미지입니다. 지금은 **글로 설명**해
        넘깁니다 — 참조 이미지를 함께 보내는 요청 형식이 아직 확인되지
        않았기 때문입니다 (§0-2). 확인되면 여기만 고치면 됩니다.
        """
        글 = prompt
        if negative_prompt:
            글 = f"{글}\n\n[피할 것] {negative_prompt}"

        몸통: dict[str, Any] = {"model": self._require_model(), "prompt": 글,
                               "size": SIZE, "n": 1}
        try:
            r = self._http.request("POST", f"{self.base_url}/images/generations",
                                   headers=self._headers(), json=몸통,
                                   timeout=self._timeout)
        except HttpError as exc:
            raise self._friendly(exc) from None
        if not r.ok:
            raise self._from_status(r.status, r.text)

        자료 = (r.json() or {}).get("data") or []
        if not 자료:
            raise ProviderError(
                retry=Retry.MANUAL,
                user_message="이미지를 만들지 못했습니다. 다시 시도해 주세요.",
                log_detail=masking.scrub(f"empty data: {r.text[:300]}"),
                provider=self.name)

        칸 = 자료[0]
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if 칸.get("b64_json"):
            dest.write_bytes(base64.b64decode(칸["b64_json"]))
            return dest
        if 칸.get("url"):
            # **곧바로 내려받습니다.** 주소만 갖고 있으면 나중에 사라집니다.
            try:
                got = self._http.request("GET", str(칸["url"]), timeout=self._timeout)
            except HttpError as exc:
                raise self._friendly(exc) from None
            if not got.ok:
                raise self._from_status(got.status, got.text)
            dest.write_bytes(got.body)
            return dest
        raise ProviderError(
            retry=Retry.MANUAL,
            user_message="이미지를 만들지 못했습니다. 다시 시도해 주세요.",
            log_detail=masking.scrub(f"no image payload: {str(칸)[:300]}"),
            provider=self.name)

    # ── 오류 번역 ─────────────────────────────────────────
    def _from_status(self, status: int, text: str) -> ProviderError:
        detail = masking.scrub(text[:600])
        if status in (401, 403):
            return ProviderError(retry=Retry.NEVER_AUTH,
                                 user_message="사용 키에 문제가 있습니다. 회사에 문의해 주세요.",
                                 log_detail=detail, provider=self.name,
                                 vendor_code=str(status))
        if status in (400, 404):
            return ProviderError(retry=Retry.NEVER_PARAM,
                                 user_message="이미지를 만들 수 없습니다. 설정에서 모델을 확인해 주세요.",
                                 log_detail=detail, provider=self.name,
                                 vendor_code=str(status))
        if status == 429 or status >= 500:
            return ProviderError(retry=Retry.BACKOFF,
                                 user_message="잠시 뒤에 다시 시도합니다.",
                                 log_detail=detail, provider=self.name,
                                 vendor_code=str(status))
        return ProviderError(retry=Retry.MANUAL,
                             user_message="이미지를 만들지 못했습니다. 다시 시도해 주세요.",
                             log_detail=detail, provider=self.name,
                             vendor_code=str(status))

    def _friendly(self, exc: Exception) -> ProviderError:
        return ProviderError(retry=Retry.BACKOFF,
                             user_message="인터넷 연결을 확인한 뒤 다시 눌러 주세요.",
                             log_detail=masking.scrub(f"{type(exc).__name__}: {exc}"),
                             provider=self.name)
