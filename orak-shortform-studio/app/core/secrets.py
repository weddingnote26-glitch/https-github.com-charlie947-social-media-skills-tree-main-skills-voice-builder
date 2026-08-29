"""열쇠 금고 — 윈도우 DPAPI (지시서 §10-3 · MVP 판정 18번).

    암호문은 Settings\\credentials.dat 에만 있습니다.
    SQLite · JSON · 로그 · 백업 · 배포 ZIP 어디에도 평문이 없습니다.

**잠그는 방식을 갈아끼울 수 있게 만들었습니다.** 이유는 두 가지입니다.

1. DPAPI 는 윈도우 전용이라, 리눅스 개발 환경에서는 금고 자체를 시험할 수 없습니다.
   시험용 잠금장치를 끼워 넣으면 「저장 → 다시 켜기 → 읽기」 흐름을 여기서도 확인할 수 있습니다.
2. 나중에 윈도우가 아닌 곳으로 옮기더라도 이 파일만 고치면 됩니다.

⚠️ **안전한 척하는 길을 만들지 않았습니다.**
윈도우인데 pywin32 가 없으면 **암호화 없이 저장하지 않고 그냥 멈춥니다.**
평문으로 흘리느니 안 되는 게 낫습니다.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional, Protocol

from app.contracts.errors import SecretStr
from app.core import masking

MAGIC = "ORAK-SHORTFORM-CRED"
VERSION = 1


class VaultUnavailable(Exception):
    """이 컴퓨터에서는 금고를 열 수 없습니다. 담당자에게 보여줄 한국어를 담습니다."""

    def __init__(self, user_message: str) -> None:
        super().__init__(user_message)
        self.user_message = user_message


# ─────────────────────────────────────────────────────────────
# 잠금장치
# ─────────────────────────────────────────────────────────────


class Cipher(Protocol):
    """잠그고 여는 방법. 윈도우에서는 DPAPI 가 들어옵니다."""

    name: str

    def lock(self, plain: bytes) -> bytes: ...

    def unlock(self, blob: bytes) -> bytes: ...


class DpapiCipher:
    """윈도우 DPAPI. 지금 로그인한 윈도우 계정만 열 수 있습니다.

    다른 계정이나 다른 PC 로 파일을 옮기면 열리지 않습니다. 그게 목적입니다.
    """

    name = "dpapi"

    def __init__(self) -> None:
        try:
            import win32crypt  # type: ignore
        except ImportError as exc:  # pragma: no cover - 윈도우에서만 도달
            raise VaultUnavailable(
                "열쇠를 안전하게 보관할 준비가 되지 않았습니다. 회사에 문의해 주세요."
            ) from exc
        self._crypt = win32crypt

    def lock(self, plain: bytes) -> bytes:  # pragma: no cover - 윈도우 전용
        return self._crypt.CryptProtectData(plain, "ORAK", None, None, None, 0)

    def unlock(self, blob: bytes) -> bytes:  # pragma: no cover - 윈도우 전용
        return self._crypt.CryptUnprotectData(blob, None, None, None, 0)[1]


class InsecureTestCipher:
    """**시험 전용.** 잠그는 시늉만 합니다.

    이름에 Insecure 를 넣은 것은 실수로 쓰이지 않게 하려는 것입니다.
    ``open_vault()`` 는 이걸 절대 스스로 고르지 않습니다. 시험이 직접 넣어야 합니다.
    """

    name = "insecure-test"

    def lock(self, plain: bytes) -> bytes:
        return b"TEST" + plain[::-1]

    def unlock(self, blob: bytes) -> bytes:
        if not blob.startswith(b"TEST"):
            raise ValueError("시험용 잠금장치로 만든 파일이 아닙니다")
        return blob[4:][::-1]


# ─────────────────────────────────────────────────────────────
# 금고
# ─────────────────────────────────────────────────────────────


class CredentialStore:
    """열쇠를 넣고 꺼냅니다.

    프로그램을 껐다 켜도 읽혀야 하므로 파일에 씁니다.
    파일에는 **암호문만** 들어갑니다.
    """

    def __init__(self, path: Path, cipher: Cipher,
                 masker: Optional[masking.Masker] = None) -> None:
        self._path = Path(path)
        self._cipher = cipher
        self._masker = masker or masking.default_masker()
        self._cache: dict[str, str] = {}
        self._loaded = False

    @property
    def path(self) -> Path:
        return self._path

    @property
    def cipher_name(self) -> str:
        return self._cipher.name

    # ── 읽고 쓰기 ─────────────────────────────────────────
    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self._path.exists():
            return
        try:
            blob = self._path.read_bytes()
            data = json.loads(self._cipher.unlock(blob).decode("utf-8"))
        except Exception as exc:
            # 원인을 화면에 띄우지 않습니다 (§9). 파일도 지우지 않습니다 (분리규칙 §3-3).
            raise VaultUnavailable(
                "저장해 둔 열쇠를 읽지 못했습니다. 설정에서 다시 넣어주세요."
            ) from exc
        if data.get("magic") != MAGIC:
            raise VaultUnavailable(
                "저장해 둔 열쇠를 읽지 못했습니다. 설정에서 다시 넣어주세요.")
        self._cache = dict(data.get("keys", {}))
        # 읽자마자 마스커에 등록합니다. 이 뒤로는 로그에 적어도 새지 않습니다.
        self._masker.register_all(self._cache.values())

    def _save(self) -> None:
        payload = json.dumps(
            {"magic": MAGIC, "version": VERSION, "keys": self._cache},
            ensure_ascii=False,
        ).encode("utf-8")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # 쓰다 말고 꺼져도 기존 파일이 깨지지 않게 옆에 쓰고 바꿔치웁니다.
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp.write_bytes(self._cipher.lock(payload))
        os.replace(tmp, self._path)

    # ── 쓰기 ──────────────────────────────────────────────
    def put(self, key: str, value: SecretStr | str) -> None:
        raw = value.reveal() if isinstance(value, SecretStr) else value
        if not raw or not raw.strip():
            raise ValueError("빈 값은 저장할 수 없습니다")
        self._load()
        self._cache[key] = raw
        self._masker.register(raw)
        self._save()

    def get(self, key: str) -> Optional[SecretStr]:
        self._load()
        raw = self._cache.get(key)
        return SecretStr(raw) if raw else None

    def has(self, key: str) -> bool:
        self._load()
        return key in self._cache

    def names(self) -> list[str]:
        """어떤 열쇠가 들어 있는지. **값은 돌려주지 않습니다.**"""
        self._load()
        return sorted(self._cache)

    def hint(self, key: str) -> str:
        """화면에 보여줄 형태. 예: ``sk-...★★★★`` (§10-3)"""
        s = self.get(key)
        return s.hint() if s else "아직 넣지 않았습니다"

    def clear_cache(self) -> None:
        """메모리에 올려둔 것만 비웁니다. **파일은 건드리지 않습니다.**

        「껐다 켜기」 를 흉내 낼 때 씁니다.
        """
        self._cache.clear()
        self._loaded = False


# ─────────────────────────────────────────────────────────────
# 만들기
# ─────────────────────────────────────────────────────────────


def open_vault(path: Path, *, cipher: Optional[Cipher] = None) -> CredentialStore:
    """금고를 엽니다.

    ``cipher`` 를 주지 않으면 **윈도우에서만** DPAPI 로 엽니다.
    다른 운영체제에서는 안전한 척하지 않고 그냥 멈춥니다.
    """
    if cipher is None:
        if sys.platform != "win32":
            raise VaultUnavailable(
                "이 프로그램은 윈도우에서만 열쇠를 보관할 수 있습니다."
            )
        cipher = DpapiCipher()
    return CredentialStore(path, cipher)
