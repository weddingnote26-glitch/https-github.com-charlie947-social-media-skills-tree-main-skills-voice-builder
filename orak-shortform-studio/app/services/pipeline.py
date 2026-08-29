"""제작 흐름과 **단계별 실패 처리** (2026-08-29 지시).

    담당자 입력 → 주제 발굴 → 경쟁 콘텐츠 분석 → 콘텐츠 기획 → 대본 작성
    → 이미지 생성 → 음성 생성 → 영상 생성 → 게시글/캡션 생성 → 결과 저장

**한 단계가 실패해도 앱이 꺼지지 않습니다.** 그 단계만 「실패」 로 표시하고
나머지는 그대로 둡니다. 담당자는 그 단계만 다시 누르면 됩니다.

이게 중요한 이유: 영상 만들기는 **한 번에 몇백 원씩 나갑니다.** 음성에서
실패했다고 처음부터 다시 하면 이미 낸 돈을 또 냅니다.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional

from app.contracts.errors import ProviderError, Retry


class Step(str, Enum):
    """제작 단계. 순서대로입니다."""

    TOPIC = "topic"
    COMPETITOR = "competitor"
    PLAN = "plan"
    SCRIPT = "script"
    IMAGE = "image"
    VOICE = "voice"
    VIDEO = "video"
    CAPTION = "caption"
    SAVE = "save"


STEP_LABELS: dict[Step, str] = {
    Step.TOPIC: "주제 찾기",
    Step.COMPETITOR: "사례 살피기",
    Step.PLAN: "기획",
    Step.SCRIPT: "대본 만들기",
    Step.IMAGE: "이미지 만들기",
    Step.VOICE: "목소리 만들기",
    Step.VIDEO: "영상 만들기",
    Step.CAPTION: "게시글 쓰기",
    Step.SAVE: "저장",
}

STEP_ORDER: tuple[Step, ...] = tuple(Step)

FAIL_MESSAGES: dict[Step, str] = {
    Step.SCRIPT: "대본 만들기에 실패했습니다. 인터넷 연결과 설정을 확인해 주세요.",
    Step.IMAGE: "이미지 만들기에 실패했습니다. 인터넷 연결과 설정을 확인해 주세요.",
    Step.VOICE: "목소리 만들기에 실패했습니다. 인터넷 연결과 설정을 확인해 주세요.",
    Step.VIDEO: "영상 만들기에 실패했습니다. 인터넷 연결과 설정을 확인해 주세요.",
    Step.CAPTION: "게시글 쓰기에 실패했습니다. 다시 눌러 주세요.",
}


class StepStatus(str, Enum):
    WAITING = "waiting"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class StepState:
    step: Step
    status: StepStatus = StepStatus.WAITING
    message: str = ""
    """담당자에게 보여줄 한국어 한 줄. **개발자 말이 들어가면 안 됩니다.**"""

    can_retry: bool = False
    result: Any = None
    attempts: int = 0
    updated_at: float = field(default_factory=time.time)

    @property
    def label(self) -> str:
        return STEP_LABELS[self.step]


class Production:
    """한 편을 만드는 동안의 상태.

    단계마다 따로 성공·실패합니다. 실패한 단계만 다시 부를 수 있습니다.
    """

    def __init__(self, steps: tuple[Step, ...] = STEP_ORDER) -> None:
        self.states: dict[Step, StepState] = {s: StepState(s) for s in steps}
        self.order = steps

    # ── 보기 ──────────────────────────────────────────────
    def state(self, step: Step) -> StepState:
        return self.states[step]

    @property
    def failed(self) -> list[StepState]:
        return [s for s in self.states.values() if s.status is StepStatus.FAILED]

    @property
    def done(self) -> list[StepState]:
        return [s for s in self.states.values() if s.status is StepStatus.DONE]

    def result(self, step: Step) -> Any:
        return self.states[step].result

    def is_complete(self) -> bool:
        return all(s.status in (StepStatus.DONE, StepStatus.SKIPPED)
                   for s in self.states.values())

    def summary(self) -> str:
        기호 = {StepStatus.DONE: "완료", StepStatus.FAILED: "실패",
              StepStatus.RUNNING: "하는 중", StepStatus.SKIPPED: "건너뜀",
              StepStatus.WAITING: "기다리는 중"}
        return "\n".join(f"{STEP_LABELS[s.step]}: {기호[s.status]}"
                         + (f" — {s.message}" if s.message else "")
                         for s in self.states.values())

    # ── 돌리기 ────────────────────────────────────────────
    def run(self, step: Step, work: Callable[[], Any], *,
            skip_if: bool = False, policy=None,
            sleep=None, on_wait=None) -> StepState:
        """한 단계를 돌립니다. **여기서 예외가 밖으로 나가지 않습니다.**

        어떤 예외가 나도 그 단계만 「실패」 가 되고 프로그램은 살아 있습니다.
        `ProviderError` 면 그 안에 든 한국어를 그대로 보여주고,
        그 밖의 예외는 개발자 말이 새지 않게 **일반 문장으로 바꿉니다** (보안 원칙).
        """
        st = self.states[step]
        if skip_if:
            st.status, st.message, st.can_retry = StepStatus.SKIPPED, "", False
            st.updated_at = time.time()
            return st

        st.status = StepStatus.RUNNING
        st.attempts += 1
        st.updated_at = time.time()
        일감 = work
        if policy is not None:
            # 잠깐 막힌 것(429·5xx·인터넷)만 알아서 다시 부릅니다.
            # 열쇠나 설정이 틀린 것은 몇 번을 해도 같아서 곧바로 올라옵니다.
            from app.services.recovery import run_with_retry

            def 일감():                                    # noqa: F811
                풀옵션 = {"policy": policy}
                if sleep is not None:
                    풀옵션["sleep"] = sleep
                if on_wait is not None:
                    풀옵션["on_wait"] = on_wait
                return run_with_retry(work, **풀옵션)
        try:
            st.result = 일감()
        except ProviderError as e:
            st.status = StepStatus.FAILED
            st.message = e.user_message
            st.can_retry = e.retry is not Retry.NEVER_PARAM
        except Exception:
            # traceback 을 화면에 올리지 않습니다 (보안 원칙).
            st.status = StepStatus.FAILED
            st.message = FAIL_MESSAGES.get(
                step, f"{STEP_LABELS[step]}에 실패했습니다. 다시 눌러 주세요.")
            st.can_retry = True
        else:
            st.status = StepStatus.DONE
            st.message = ""
            st.can_retry = False
        st.updated_at = time.time()
        return st

    def retry(self, step: Step, work: Callable[[], Any], **kw) -> StepState:
        """그 단계**만** 다시. 앞 단계 결과는 그대로 둡니다.

        이미 끝난 단계는 다시 부르지 않습니다 — **돈이 두 번 나갑니다.**
        """
        st = self.states[step]
        if st.status is StepStatus.DONE:
            return st
        return self.run(step, work, **kw)
