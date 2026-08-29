"""어느 회사 것을 쓸지 (2026-08-29 지시로 확정).

    대본   OpenAI
    이미지  OpenAI
    목소리  ElevenLabs
    영상   Kling AI

**기본값을 여기 한 군데에만 적습니다.** 담당자가 설정에서 바꾸면 그 값이
`settings` 표에 남고 다음부터 그걸 씁니다. 코드를 고치지 않습니다.

전에 쓰던 Claude 대본 공급자도 **그대로 남아 있습니다.** 지우지 않았습니다 —
설정에서 골라 되돌릴 수 있습니다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from app.contracts.errors import ProviderError, Retry, SecretStr

PRICING_PATH = Path(__file__).resolve().parents[2] / "assets" / "pricing.json"

# ── 기본값 ────────────────────────────────────────────────
DEFAULT_SCRIPT = "openai"
DEFAULT_IMAGE = "openai"
DEFAULT_VOICE = "elevenlabs"
DEFAULT_VIDEO = "kling"

SETTING_KEYS = {
    "script": "provider.script",
    "image": "provider.image",
    "voice": "provider.voice",
    "video": "provider.video",
}

VAULT_KEYS = {
    "openai": "openai",
    "claude": "claude",
    "elevenlabs": "elevenlabs",
    "kling": "kling",
    "gemini": "gemini",
}
"""공급자 이름 → 금고에 든 열쇠 이름."""


@dataclass(frozen=True)
class ProviderChoice:
    kind: str
    """script · image · voice · video"""

    name: str
    label: str
    ready: bool
    """지금 쓸 수 있는가 (열쇠 있고 모델 골랐고 구현돼 있는가)."""

    note: str = ""


class NotBuiltYet(ProviderError):
    """아직 안 만든 공급자입니다. **가짜로 만들어 두지 않습니다** (§0-2)."""

    def __init__(self, name: str, 왜: str) -> None:
        super().__init__(
            retry=Retry.NEVER_PARAM,
            user_message=f"{왜} 회사에 문의해 주세요.",
            log_detail=f"provider not implemented: {name}",
            provider=name)


def load_pricing() -> dict[str, Any]:
    try:
        return json.loads(PRICING_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


class ProviderRegistry:
    """설정을 보고 알맞은 공급자를 만들어 줍니다.

    화면은 여기까지만 압니다. 어느 회사 SDK 를 쓰는지 화면은 모릅니다.
    """

    def __init__(self, db=None, vault=None,
                 pricing: Optional[dict[str, Any]] = None,
                 http=None) -> None:
        self._db = db
        self._vault = vault
        self._pricing = pricing if pricing is not None else load_pricing()
        self._http = http

    # ── 설정 읽고 쓰기 ────────────────────────────────────
    def chosen(self, kind: str) -> str:
        기본 = {"script": DEFAULT_SCRIPT, "image": DEFAULT_IMAGE,
               "voice": DEFAULT_VOICE, "video": DEFAULT_VIDEO}[kind]
        if self._db is None:
            return 기본
        return self._db.get_setting(SETTING_KEYS[kind], 기본) or 기본

    def choose(self, kind: str, name: str) -> None:
        if self._db is not None:
            self._db.put_setting(SETTING_KEYS[kind], name)

    def setting(self, key: str, default: str = "") -> str:
        return self._db.get_setting(key, default) if self._db else default

    def _key(self, name: str) -> Optional[SecretStr]:
        if self._vault is None:
            return None
        금고이름 = VAULT_KEYS.get(name, name)
        try:
            return self._vault.get(금고이름)
        except Exception:
            return None

    def _price(self, 항목: str) -> dict[str, Any]:
        """`assets/pricing.json` 의 한 칸 + 환율.

        값이 `null` 이면 그대로 둡니다. 공급자가 「모른다」 고 답해야
        비용 게이트가 막아 줍니다. **0 으로 채우지 않습니다** (§9).
        """
        칸 = self._pricing.get(항목, {})
        out = dict(칸) if isinstance(칸, dict) else {}
        환율 = self._pricing.get("환율")
        if isinstance(환율, dict):
            환율 = 환율.get("원_per_달러")
        if 환율 is not None:
            out.setdefault("환율", float(환율))
        return out

    def _claude_price(self) -> dict[str, Any]:
        """Claude 는 모델마다 단가가 달라 한 겹 더 들어갑니다."""
        칸 = self._price("대본_claude")
        모델 = self.setting("claude.script_model", 칸.get("기본모델", ""))
        단가 = (칸.get("모델별") or {}).get(모델, {})
        return {**칸, **단가}

    # ── 만들어 주기 ───────────────────────────────────────
    def script_provider(self):
        고른것 = self.chosen("script")
        if 고른것 == "claude":
            from app.providers.llm_claude import ClaudeScriptProvider
            return ClaudeScriptProvider(
                api_key=self._key("claude"),
                model=self.setting("claude.script_model", "claude-opus-5"),
                pricing=self._claude_price())
        from app.providers.llm_openai import MODEL_SETTING_KEY, OpenAIScriptProvider
        return OpenAIScriptProvider(
            api_key=self._key("openai"), http=self._http,
            model=self.setting(MODEL_SETTING_KEY),
            base_url=self.setting("openai.base_url",
                                  "https://api.openai.com/v1"),
            pricing=self._price("대본_openai"))

    def image_provider(self):
        고른것 = self.chosen("image")
        if 고른것 == "gemini":
            raise NotBuiltYet(
                "gemini", "제미나이 이미지는 아직 붙이지 않았습니다.")
        from app.providers.image_openai import MODEL_SETTING_KEY, OpenAIImageProvider
        return OpenAIImageProvider(
            api_key=self._key("openai"), http=self._http,
            model=self.setting(MODEL_SETTING_KEY),
            base_url=self.setting("openai.base_url",
                                  "https://api.openai.com/v1"),
            pricing=self._price("이미지_openai"))

    def voice_provider(self):
        from app.providers.tts_elevenlabs import (
            MODEL_SETTING_KEY, VOICE_SETTING_KEY, ElevenLabsTTSProvider)
        return ElevenLabsTTSProvider(
            api_key=self._key("elevenlabs"), http=self._http,
            model=self.setting(MODEL_SETTING_KEY),
            voice_id=self.setting(VOICE_SETTING_KEY),
            base_url=self.setting("elevenlabs.base_url",
                                  "https://api.elevenlabs.io/v1"),
            pricing=self._price("음성_elevenlabs"))

    def video_provider(self, *, ffmpeg=None):
        """영상. 오락이가 나오는 장면은 Kling, 실제 사진은 사진 움직이기."""
        고른것 = self.chosen("video")
        if 고른것 == "kenburns":
            from app.providers.video_kenburns import KenBurnsProvider
            return KenBurnsProvider(ffmpeg=ffmpeg)
        # Kling 은 계정 확인 4가지가 끝나야 붙입니다 (§0-2). 가짜로 만들지 않습니다.
        raise NotBuiltYet(
            "kling",
            "영상 만들기(Kling)는 계정 확인이 끝나야 쓸 수 있습니다.")

    def photo_video_provider(self, *, ffmpeg=None):
        """실제 사진을 움직이는 쪽. 이건 이미 됩니다 (Stage 6b)."""
        from app.providers.video_kenburns import KenBurnsProvider
        return KenBurnsProvider(ffmpeg=ffmpeg)

    # ── 화면에 보여줄 상태 ────────────────────────────────
    def status(self) -> list[ProviderChoice]:
        """설정 화면의 「지금 쓸 수 있는가」 줄."""
        나온것: list[ProviderChoice] = []
        for kind, label, 만들기 in (
            ("script", "대본", self.script_provider),
            ("image", "이미지", self.image_provider),
            ("voice", "목소리", self.voice_provider),
            ("video", "영상", self.video_provider),
        ):
            이름 = self.chosen(kind)
            try:
                p = 만들기()
            except ProviderError as e:
                나온것.append(ProviderChoice(kind, 이름, label, False, e.user_message))
                continue
            열쇠 = self._key(이름) is not None
            모델 = bool(getattr(p, "model", "") or kind == "video")
            메모 = ("" if 열쇠 and 모델
                  else "열쇠를 넣어주세요." if not 열쇠
                  else "모델을 골라주세요.")
            나온것.append(ProviderChoice(kind, 이름, label, 열쇠 and 모델, 메모))
        return 나온것
