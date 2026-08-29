"""목소리 만들기 — ElevenLabs (§2-2 · 2026-08-29 지시로 확정).

`TTSProvider` 계약이 이미 「모델 목록은 `GET /v1/models` 로 조회해 Settings 에서
고르게 한다. **하드코딩 금지**」 라고 정해 두었습니다. 그대로 지킵니다.

Voice ID 도 마찬가지입니다. 담당자가 ElevenLabs 화면에서 목소리를 고르면
`GET /v1/voices` 가 그 목록을 돌려주고, 설정에서 고릅니다.

⚠️ **한국어에 쓸 모델이 아직 정해지지 않았습니다.** 그래서 기본값이 없습니다.
[연결 테스트] 를 눌러 목록을 받은 뒤 골라야 씁니다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from app.contracts.errors import ProviderError, Retry, SecretStr
from app.contracts.models import CostEstimate
from app.core import masking
from app.core.http import DEFAULT_TIMEOUT, HttpClient, HttpError, RequestsHttp

BASE_URL = "https://api.elevenlabs.io/v1"
MODEL_SETTING_KEY = "elevenlabs.model"
VOICE_SETTING_KEY = "elevenlabs.voice_id"

OUTPUT_FORMAT = "mp3_44100_128"
"""합성 단계가 44.1kHz 로 맞추므로 처음부터 맞춰 받습니다 (§8)."""


class ElevenLabsTTSProvider:
    """`TTSProvider` 계약을 지킵니다 (`app/contracts/providers.py`)."""

    name = "elevenlabs"

    def __init__(self, *, api_key: Optional[SecretStr] = None,
                 http: Optional[HttpClient] = None,
                 model: str = "", voice_id: str = "",
                 base_url: str = BASE_URL,
                 pricing: Optional[dict[str, Any]] = None,
                 timeout: float = DEFAULT_TIMEOUT) -> None:
        self.model = (model or "").strip()
        self.voice_id = (voice_id or "").strip()
        self.base_url = base_url.rstrip("/")
        self._pricing = pricing or {}
        self._timeout = timeout
        self._http = http or RequestsHttp()
        self._key = api_key
        if api_key is not None:
            masking.register(api_key.reveal())

    def _headers(self, json_body: bool = False) -> dict[str, str]:
        if self._key is None:
            raise ProviderError(
                retry=Retry.NEVER_AUTH,
                user_message="목소리를 만들 열쇠가 없습니다. 설정에서 넣어주세요.",
                log_detail="elevenlabs key missing", provider=self.name)
        h = {"xi-api-key": self._key.reveal()}
        if json_body:
            h["Content-Type"] = "application/json"
        return h

    # ── 목록 (하드코딩 금지) ──────────────────────────────
    def list_models(self) -> list[tuple[str, str]]:
        자료 = self._get("/models")
        나온것 = []
        for m in 자료 or []:
            mid = str(m.get("model_id", ""))
            if not mid:
                continue
            이름 = str(m.get("name", mid))
            # 한국어를 지원하는지 표시해 줍니다. 담당자가 고르기 쉬우라고.
            언어 = m.get("languages") or []
            한국어 = any(str(l.get("language_id", "")).lower().startswith("ko")
                       or "korean" in str(l.get("name", "")).lower() for l in 언어)
            나온것.append((mid, f"{이름}{' · 한국어 됨' if 한국어 else ''}"))
        return sorted(나온것, key=lambda t: t[1])

    def list_voices(self) -> list[tuple[str, str]]:
        자료 = self._get("/voices")
        목록 = 자료.get("voices") if isinstance(자료, dict) else 자료
        나온것 = [(str(v.get("voice_id", "")), str(v.get("name", "")))
                for v in (목록 or []) if v.get("voice_id")]
        return sorted(나온것, key=lambda t: t[1])

    def health(self) -> tuple[bool, str]:
        try:
            모델 = self.list_models()
            목소리 = self.list_voices()
        except ProviderError as e:
            return False, e.user_message
        if not self.model or not self.voice_id:
            return True, (f"연결됐습니다. 모델 {len(모델)}개 · 목소리 {len(목소리)}개 "
                          "중에서 골라주세요.")
        if self.model not in {m for m, _ in 모델}:
            return False, "고른 모델을 쓸 수 없습니다. 목록에서 다시 골라주세요."
        if self.voice_id not in {v for v, _ in 목소리}:
            return False, "고른 목소리를 쓸 수 없습니다. 목록에서 다시 골라주세요."
        return True, "목소리 만들기를 쓸 수 있습니다."

    # ── 비용 ──────────────────────────────────────────────
    def estimate(self, text: str) -> CostEstimate:
        """한글 글자 수 ÷ 1000 × 1천자 단가 (계약 문서 그대로)."""
        단가 = self._pricing.get("천자당_달러")
        rate = self._pricing.get("환율", 1380.0)
        if 단가 is None:
            return CostEstimate(krw=0, breakdown=(("목소리", 0),), is_complete=False)
        krw = round(len(text) / 1000 * 단가 * rate)
        return CostEstimate(krw=krw, breakdown=(("목소리", krw),))

    # ── 만들기 ────────────────────────────────────────────
    def synthesize(self, *, text: str, voice_id: str = "", model: str = "",
                   dest: Path) -> Path:
        voice = (voice_id or self.voice_id).strip()
        mdl = (model or self.model).strip()
        if not voice or not mdl:
            raise ProviderError(
                retry=Retry.NEVER_PARAM,
                user_message="목소리와 모델을 아직 고르지 않았습니다. "
                             "설정에서 [연결 테스트] 를 누른 뒤 골라주세요.",
                log_detail="elevenlabs voice/model not configured",
                provider=self.name)
        if not text.strip():
            raise ProviderError(
                retry=Retry.NEVER_PARAM,
                user_message="읽을 말이 비어 있습니다.",
                log_detail="empty text", provider=self.name)

        몸통 = {"text": text, "model_id": mdl}
        url = f"{self.base_url}/text-to-speech/{voice}?output_format={OUTPUT_FORMAT}"
        try:
            r = self._http.request("POST", url, headers=self._headers(True),
                                   json=몸통, timeout=self._timeout)
        except HttpError as exc:
            raise self._friendly(exc) from None
        if not r.ok:
            raise self._from_status(r.status, r.text)
        if not r.body:
            raise ProviderError(
                retry=Retry.MANUAL,
                user_message="목소리를 만들지 못했습니다. 다시 시도해 주세요.",
                log_detail="empty audio body", provider=self.name)

        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.body)
        return dest

    # ── 속 ────────────────────────────────────────────────
    def _get(self, path: str) -> Any:
        try:
            r = self._http.request("GET", f"{self.base_url}{path}",
                                   headers=self._headers(), timeout=self._timeout)
        except HttpError as exc:
            raise self._friendly(exc) from None
        if not r.ok:
            raise self._from_status(r.status, r.text)
        return r.json()

    def _from_status(self, status: int, text: str) -> ProviderError:
        detail = masking.scrub(text[:600])
        if status in (401, 403):
            return ProviderError(retry=Retry.NEVER_AUTH,
                                 user_message="사용 키에 문제가 있습니다. 회사에 문의해 주세요.",
                                 log_detail=detail, provider=self.name,
                                 vendor_code=str(status))
        if status in (400, 404, 422):
            return ProviderError(retry=Retry.NEVER_PARAM,
                                 user_message="목소리를 만들 수 없습니다. 설정에서 목소리와 모델을 확인해 주세요.",
                                 log_detail=detail, provider=self.name,
                                 vendor_code=str(status))
        if status == 429 or status >= 500:
            return ProviderError(retry=Retry.BACKOFF,
                                 user_message="잠시 뒤에 다시 시도합니다.",
                                 log_detail=detail, provider=self.name,
                                 vendor_code=str(status))
        return ProviderError(retry=Retry.MANUAL,
                             user_message="목소리를 만들지 못했습니다. 다시 시도해 주세요.",
                             log_detail=detail, provider=self.name,
                             vendor_code=str(status))

    def _friendly(self, exc: Exception) -> ProviderError:
        return ProviderError(retry=Retry.BACKOFF,
                             user_message="인터넷 연결을 확인한 뒤 다시 눌러 주세요.",
                             log_detail=masking.scrub(f"{type(exc).__name__}: {exc}"),
                             provider=self.name)
