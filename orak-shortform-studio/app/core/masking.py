"""로그로 나가는 모든 글자가 지나는 관문 (지시서 §10-3 · MVP 판정 18번).

**이 파일에는 단위시험이 반드시 붙습니다.** 지시서가 명시한 몇 안 되는 시험 요구사항입니다.
``tests/test_storage.py`` 를 보세요.

두 겹으로 막습니다.

1. **등록된 값** — 실제로 쓰고 있는 열쇠를 통째로 지웁니다. 가장 확실합니다.
2. **생김새** — 등록되지 않은 값이라도 열쇠처럼 생겼으면 지웁니다.
   새 서비스를 붙였는데 등록을 깜빡한 경우를 대비한 그물입니다.

두 겹인 이유는, 한 겹만으로는 언젠가 새기 때문입니다.
"""

from __future__ import annotations

import re
from typing import Iterable

MASK = "★★★★"

_MIN_REGISTER_LEN = 6
"""이보다 짧은 값은 등록해도 무시합니다.
"1234" 같은 짧은 값을 등록하면 멀쩡한 글에서 숫자가 사라집니다.
"""

# 열쇠처럼 생긴 것들. 순서가 중요합니다 — 긴 것부터 지워야 조각이 안 남습니다.
_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    # Anthropic
    (re.compile(r"sk-ant-[A-Za-z0-9_\-]{8,}"), "anthropic"),
    # ElevenLabs
    (re.compile(r"\bsk_[A-Za-z0-9]{16,}"), "elevenlabs"),
    # Google
    (re.compile(r"\bAIza[A-Za-z0-9_\-]{20,}"), "google"),
    # 일반적인 sk- 계열
    (re.compile(r"sk-[A-Za-z0-9_\-]{16,}"), "generic-sk"),
    # 헤더에 실려 나가는 것들
    (re.compile(r"(?i)\b(authorization)\s*[:=]\s*(bearer\s+)?\S+"), "auth-header"),
    (re.compile(r"(?i)\b(xi-api-key|x-api-key|api[_\-]?key)\s*[:=]\s*\S+"), "key-header"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{12,}"), "bearer"),
)

_HEADER_PATTERNS = {"auth-header", "key-header"}


class Masker:
    """등록된 열쇠와 열쇠처럼 생긴 글자를 ★★★★ 로 바꿉니다.

    프로그램이 켜질 때 금고에서 꺼낸 열쇠를 ``register()`` 로 넣어두면,
    그 뒤로 로그에 무엇을 적든 그 값은 나가지 않습니다.
    """

    def __init__(self) -> None:
        self._known: set[str] = set()

    # ── 등록 ──────────────────────────────────────────────
    def register(self, value: str | None) -> None:
        """이 값은 절대 로그에 나가면 안 된다고 알려줍니다."""
        if value and len(value) >= _MIN_REGISTER_LEN:
            self._known.add(value)

    def register_all(self, values: Iterable[str | None]) -> None:
        for v in values:
            self.register(v)

    def forget_all(self) -> None:
        """등록을 비웁니다. 시험에서만 씁니다."""
        self._known.clear()

    @property
    def registered_count(self) -> int:
        return len(self._known)

    # ── 지우기 ────────────────────────────────────────────
    def scrub(self, text: object) -> str:
        """로그로 나갈 글자에서 열쇠를 지웁니다.

        문자열이 아닌 것도 받습니다. 예외 객체·사전·목록을 그대로 넘겨도
        문자열로 바꾼 뒤 지웁니다. **어디서든 부를 수 있어야 새지 않습니다.**
        """
        s = text if isinstance(text, str) else str(text)

        # 1) 등록된 값 — 긴 것부터 지워야 조각이 안 남습니다.
        for value in sorted(self._known, key=len, reverse=True):
            if value in s:
                s = s.replace(value, MASK)

        # 2) 생김새로 잡기
        for pattern, name in _PATTERNS:
            if name in _HEADER_PATTERNS:
                # 헤더 이름은 남기고 값만 지웁니다. 어느 열쇠가 문제인지는 알아야 하니까요.
                s = pattern.sub(lambda m: f"{m.group(1)}: {MASK}", s)
            else:
                s = pattern.sub(MASK, s)
        return s

    def is_clean(self, text: object) -> bool:
        """이 글자를 그대로 로그에 적어도 되는가."""
        s = text if isinstance(text, str) else str(text)
        return self.scrub(s) == s


_default = Masker()


def register(value: str | None) -> None:
    """프로그램 전체가 함께 쓰는 마스커에 열쇠를 등록합니다."""
    _default.register(value)


def scrub(text: object) -> str:
    """프로그램 전체가 함께 쓰는 마스커로 지웁니다."""
    return _default.scrub(text)


def is_clean(text: object) -> bool:
    return _default.is_clean(text)


def default_masker() -> Masker:
    return _default
