"""오류 분류와 비밀값 타입 — Stage 1 인터페이스 정의.

이 파일이 존재하는 이유는 두 가지입니다.

1. **재시도해도 되는 실패와 그러면 안 되는 실패를 타입으로 갈라놓기 위해서.**
   지시서 §2-1은 1200번대(파라미터 오류)를 재시도하면 "몇 번을 보내도 같은 결과이고
   비용만 나간다"고 못박았습니다(MVP 판정 22번). 반대로 1302·1303(동시성 초과)은
   지수 백오프로 자동 회복해야 합니다(MVP 판정 21번).
   각 Provider 가 자기 벤더 코드를 여기 Retry 로 번역하고,
   파이프라인은 **벤더 코드를 절대 보지 않습니다.**

2. **담당자에게 보여줄 문장과 로그에 남길 문장을 분리하기 위해서.**
   지시서 §9는 stack trace·HTTP 상태코드·JSON 원문을 화면에 띄우는 것을 금지합니다.
   그래서 모든 오류는 user_message 와 log_detail 을 따로 가집니다.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

# ─────────────────────────────────────────────────────────────
# 비밀값
# ─────────────────────────────────────────────────────────────

MASK_TOKEN = "★★★★"


class SecretStr:
    """API 키처럼 절대 로그·화면에 나오면 안 되는 문자열.

    지시서 §0-3 8~10번 · §10-3.

    이 타입은 **처음부터 안전합니다.** __str__ 과 __repr__ 가 언제나 가려진 값을
    돌려주므로, f-string·print·logging·예외 메시지 어디에 실수로 넣어도 원문이
    새지 않습니다. 원문이 필요한 곳은 reveal() 을 명시적으로 불러야 하고,
    그 호출 지점은 검색으로 전부 셀 수 있습니다.

    Stage 3 에서 DPAPI 저장과 마스킹 단위시험이 붙습니다.
    """

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        self._value = value

    def reveal(self) -> str:
        """원문을 꺼낸다. **API 호출 직전에만** 쓰고 변수에 담아두지 말 것."""
        return self._value

    def hint(self) -> str:
        """화면에 보여줄 형태. 예: ``sk-...★★★★`` (지시서 §10-3)"""
        head = self._value[:3] if len(self._value) >= 3 else ""
        return f"{head}...{MASK_TOKEN}"

    def __str__(self) -> str:
        return MASK_TOKEN

    def __repr__(self) -> str:
        return f"SecretStr({MASK_TOKEN})"

    def __bool__(self) -> bool:
        return bool(self._value)

    def __len__(self) -> int:
        return len(self._value)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, SecretStr):
            return self._value == other._value
        return NotImplemented

    def __hash__(self) -> int:  # pragma: no cover - 사전 키로 쓸 일은 없음
        return hash(self._value)


# ─────────────────────────────────────────────────────────────
# 재시도 분류
# ─────────────────────────────────────────────────────────────


class Retry(Enum):
    """이 실패를 다시 시도해도 되는가."""

    BACKOFF = "backoff"
    """자동 재시도한다. 지수 백오프(최초 지연 1초 이상).

    Kling 1302(요청 과다) · 1303(동시성 초과) · 5000~5002(서버 오류).
    지시서 §2-1 「동시성」과 MVP 판정 21번.
    """

    NEVER_PARAM = "never_param"
    """**재시도 금지.** 요청이 틀린 것이라 다시 보내도 같은 결과이고 비용만 나간다.

    Kling 1200~1203. 로그에 남기고 즉시 멈춘다. MVP 판정 22번.
    """

    NEVER_AUTH = "never_auth"
    """재시도 금지. 키·권한·잔액 문제라 사람이 조치해야 한다.

    Kling 1000~1004(인증) · 1101(미납) · 1102(잔액 소진) · 1103(권한) · 1304(IP).
    """

    NEVER_CONTENT = "never_content"
    """재시도 금지. 콘텐츠 정책에 걸렸다. 대본을 고쳐야 한다.

    Kling 1301. 벤더가 준 사유 원문은 담당자에게 보여주지 않고
    "이 장면은 만들 수 없습니다. 대본을 조금 바꿔 다시 시도해 주세요." 로 바꾼다.
    """

    MANUAL = "manual"
    """자동 재시도를 다 쓰고도 실패. 화면에 [다시 시도] 버튼을 띄운다."""

    @property
    def is_automatic(self) -> bool:
        """프로그램이 스스로 다시 보내도 되는가."""
        return self is Retry.BACKOFF


# ─────────────────────────────────────────────────────────────
# 오류
# ─────────────────────────────────────────────────────────────


class ProviderError(Exception):
    """모든 외부 서비스 실패는 이 타입으로 바뀐 뒤에 파이프라인으로 올라온다.

    Provider 바깥에서는 벤더의 HTTP 상태코드나 오류 코드를 볼 수 없다.
    보이는 것은 Retry 분류와 담당자용 한국어 문장뿐이다.
    """

    def __init__(
        self,
        *,
        retry: Retry,
        user_message: str,
        log_detail: str,
        provider: str,
        vendor_code: Optional[str] = None,
    ) -> None:
        super().__init__(user_message)
        self.retry = retry
        self.user_message = user_message
        """담당자에게 그대로 보여줄 한국어 한 문장. 영어·전문용어·코드 금지 (§9)."""
        self.log_detail = log_detail
        """``Logs\\`` 에만 남길 상세. **마스킹을 이미 거친 문자열이어야 한다.**"""
        self.provider = provider
        self.vendor_code = vendor_code
        """벤더 오류 코드. 로그 전용이며 화면에 띄우지 않는다."""

    def __str__(self) -> str:
        return self.user_message

    def __repr__(self) -> str:
        return (
            f"ProviderError(provider={self.provider!r}, "
            f"retry={self.retry.value!r}, vendor_code={self.vendor_code!r})"
        )


class BudgetExceeded(ProviderError):
    """월 한도(기본 50,000원)에 도달해 생성을 막았다. 지시서 §11."""


class PlanRejected(Exception):
    """호출 전 검사에서 걸렸다. **돈이 나가기 전에** 멈춘 것이므로 오류가 아니다.

    - 총 길이가 30초를 넘음 (§8 — 자동으로 잘라내지 말 것)
    - Kling 클립 수가 한도를 넘음 (§1-1 기본 2 · 상한 3)
    - 예상 비용이 남은 월 한도를 넘음 (§11)
    """

    def __init__(self, *, user_message: str, hints: tuple[str, ...] = ()) -> None:
        super().__init__(user_message)
        self.user_message = user_message
        self.hints = hints
        """무엇을 고치면 되는지. 예: ("Scene 3 을 2초 줄이세요",)"""
