"""다시 하기 · 껐다 켜도 이어서 (Stage 10).

두 가지를 합니다.

1. **다시 하기** — 잠깐 막힌 것(`Retry.BACKOFF`)만 자동으로 다시 부릅니다.
   열쇠가 틀렸거나 설정이 잘못된 것은 **몇 번을 해도 같습니다.** 그런 건
   다시 부르지 않고 담당자에게 무엇을 고쳐야 하는지 알립니다.

2. **껐다 켜도 이어서** — 프로그램이 꺼져도 이미 **돈이 나간 작업**은
   그대로 남아 있습니다. 다시 켜면 그 작업들을 찾아 **조회만** 해서 결과를
   내려받습니다.

   **다시 제출하지 않습니다.** 다시 제출하면 이미 낸 돈을 또 냅니다.
   손잡이(`external_task_id`)가 이미 있으면 그걸로 물어보기만 합니다.

   Kling 결과는 **30일 뒤 지워집니다** (§2-1). 그보다 오래된 작업은
   내려받으려 하지 않고, 담당자에게 「다시 만들어야 합니다」 라고 알립니다.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, Sequence

from app.contracts.errors import ProviderError, Retry
from app.contracts.models import VideoJob, VideoJobState, VideoOutcome

RESULT_LIFETIME_DAYS = 30.0
"""Kling 결과가 남아 있는 기간 (§2-1 · MVP 판정 20번)."""

DAY = 86400.0


# ─────────────────────────────────────────────────────────────
# 다시 하기
# ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RetryPolicy:
    """몇 번, 얼마나 기다렸다 다시 부를지.

    기다리는 시간을 늘려 갑니다. 상대가 「잠시 뒤에」 라고 했는데 곧바로
    다시 부르면 더 오래 막힙니다.
    """

    max_attempts: int = 3
    base_delay_sec: float = 2.0
    max_delay_sec: float = 60.0
    jitter: float = 0.25
    """여러 장면을 한꺼번에 다시 부를 때 **같은 순간에 몰리지 않게** 흩뜨립니다."""

    def delay_for(self, attempt: int, *, rand: Optional[Callable[[], float]] = None
                  ) -> float:
        """`attempt` 번째 실패 뒤 기다릴 시간 (1부터)."""
        기본 = min(self.base_delay_sec * (2 ** max(attempt - 1, 0)),
                 self.max_delay_sec)
        if self.jitter <= 0:
            return 기본
        r = (rand or random.random)()
        return 기본 * (1.0 - self.jitter + 2 * self.jitter * r)


DEFAULT_POLICY = RetryPolicy()


def run_with_retry(work: Callable[[], Any], *,
                   policy: RetryPolicy = DEFAULT_POLICY,
                   sleep: Callable[[float], None] = time.sleep,
                   on_wait: Optional[Callable[[int, float], None]] = None,
                   rand: Optional[Callable[[], float]] = None) -> Any:
    """`work` 를 부르되, **잠깐 막힌 것만** 다시 부릅니다.

    다시 부르는 경우: `Retry.BACKOFF` (429 · 5xx · 인터넷 끊김).
    다시 안 부르는 경우:
      · `NEVER_AUTH` — 열쇠가 틀렸습니다. 백 번 해도 같습니다.
      · `NEVER_PARAM` — 보낸 값이 틀렸습니다. 고쳐야 합니다.
      · `MANUAL` — 담당자가 보고 판단할 일입니다.
      · 그 밖의 예외 — 무슨 일인지 모르는 채로 **돈이 나가는 일을 반복하지 않습니다.**

    Args:
        on_wait: (몇 번째, 몇 초 기다림) 을 받아 화면에 알려주는 함수.
    """
    마지막: Optional[ProviderError] = None
    for 회차 in range(1, max(policy.max_attempts, 1) + 1):
        try:
            return work()
        except ProviderError as e:
            if not e.retry.is_automatic:
                raise
            마지막 = e
            if 회차 >= policy.max_attempts:
                break
            기다림 = policy.delay_for(회차, rand=rand)
            if on_wait is not None:
                on_wait(회차, 기다림)
            sleep(기다림)
    assert 마지막 is not None
    raise 마지막


# ─────────────────────────────────────────────────────────────
# 껐다 켜도 이어서
# ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Pending:
    """다시 켰을 때 발견한, 아직 안 끝난 작업 하나."""

    job_id: int
    project_id: Optional[int]
    job: VideoJob
    age_days: float
    store_name: str = ""
    folder_path: str = ""

    @property
    def expired(self) -> bool:
        """결과가 이미 지워졌을 만큼 오래됐는가 (§2-1)."""
        return self.age_days >= RESULT_LIFETIME_DAYS

    @property
    def label(self) -> str:
        """담당자에게 보여줄 한 줄. **개발자 말이 없어야 합니다** (§9)."""
        가게 = self.store_name or "이름 없는 작업"
        언제 = ("오늘" if self.age_days < 1
              else f"{int(self.age_days)}일 전")
        if self.expired:
            return f"{가게} · 장면 {self.job.scene_idx} · {언제} — 결과가 지워졌습니다"
        return f"{가게} · 장면 {self.job.scene_idx} · {언제}에 맡겨 둔 것"


@dataclass(frozen=True)
class Resumed:
    """이어서 해 본 결과 하나."""

    pending: Pending
    outcome: VideoOutcome
    path: Optional[Path] = None
    message: str = ""


class RecoveryService:
    """프로그램을 다시 켰을 때 하던 일을 잇습니다 (MVP 판정 12번)."""

    def __init__(self, db, *,
                 provider_for: Optional[Callable[[str], Any]] = None,
                 clock: Callable[[], float] = time.time) -> None:
        self._db = db
        self._provider_for = provider_for
        self._clock = clock

    # ── 찾기 ──────────────────────────────────────────────
    def pending(self) -> list[Pending]:
        지금 = self._clock()
        나온것: list[Pending] = []
        for r in self._db.unfinished_video_rows():
            맡긴때 = float(r.get("request_at") or 지금)
            나온것.append(Pending(
                job_id=int(r["id"]),
                project_id=r.get("project_id"),
                job=VideoJob(provider=r.get("provider", ""),
                             scene_idx=int(r.get("scene_idx") or 0),
                             external_task_id=r.get("external_task_id", ""),
                             vendor_task_id=r.get("vendor_task_id", ""),
                             submitted_at=맡긴때),
                age_days=max((지금 - 맡긴때) / DAY, 0.0),
                store_name=r.get("store_name") or "",
                folder_path=r.get("folder_path") or "",
            ))
        return 나온것

    def notice(self) -> str:
        """다시 켰을 때 맨 위에 띄울 한 줄. 없으면 빈 글."""
        있는것 = self.pending()
        if not 있는것:
            return ""
        지워진것 = [p for p in 있는것 if p.expired]
        살아있는것 = [p for p in 있는것 if not p.expired]
        줄 = []
        if 살아있는것:
            줄.append(f"지난번에 맡겨 둔 영상 {len(살아있는것)}개가 있습니다. "
                     "[이어서 하기] 를 누르면 결과를 받아옵니다.")
        if 지워진것:
            줄.append(f"{len(지워진것)}개는 맡긴 지 {int(RESULT_LIFETIME_DAYS)}일이 지나 "
                     "결과가 지워졌습니다. 그 장면은 다시 만들어야 합니다.")
        return "\n".join(줄)

    # ── 잇기 ──────────────────────────────────────────────
    def resume(self, *, dest_for: Callable[[Pending], Path],
               provider: Any = None,
               policy: RetryPolicy = DEFAULT_POLICY,
               sleep: Callable[[float], None] = time.sleep) -> list[Resumed]:
        """맡겨 둔 작업들의 결과를 받아옵니다.

        **다시 제출하지 않습니다.** 이미 낸 돈을 또 내게 됩니다.
        손잡이로 **물어보기만** 하고, 다 됐으면 곧바로 내려받습니다.
        """
        결과: list[Resumed] = []
        묶음: dict[str, list[Pending]] = {}
        for p in self.pending():
            if p.expired:
                결과.append(self._give_up(p))
                continue
            묶음.setdefault(p.job.provider, []).append(p)

        for 공급자이름, 것들 in 묶음.items():
            prov = provider or self._make(공급자이름)
            if prov is None:
                for p in 것들:
                    결과.append(Resumed(
                        p, VideoOutcome.PROCESSING,
                        message="지금은 이어서 할 수 없습니다. 회사에 문의해 주세요."))
                continue
            결과 += self._resume_batch(prov, 것들, dest_for, policy, sleep)
        return 결과

    def _make(self, 이름: str) -> Any:
        if self._provider_for is None:
            return None
        try:
            return self._provider_for(이름)
        except Exception:
            # 아직 안 붙인 공급자일 수 있습니다. 여기서 프로그램이 죽으면 안 됩니다.
            return None

    def _resume_batch(self, prov: Any, 것들: Sequence[Pending],
                      dest_for: Callable[[Pending], Path],
                      policy: RetryPolicy,
                      sleep: Callable[[float], None]) -> list[Resumed]:
        # **한 번에 물어봅니다.** 조회는 동시처리 수를 쓰지 않습니다 (§2-1).
        try:
            상태들 = run_with_retry(lambda: prov.poll([p.job for p in 것들]),
                                  policy=policy, sleep=sleep)
        except ProviderError as e:
            return [Resumed(p, VideoOutcome.PROCESSING, message=e.user_message)
                    for p in 것들]
        except Exception:
            return [Resumed(p, VideoOutcome.PROCESSING,
                            message="이어서 하지 못했습니다. 다시 눌러 주세요.")
                    for p in 것들]

        짝 = {s.job.external_task_id: s for s in 상태들}
        나온것: list[Resumed] = []
        for p in 것들:
            상태 = 짝.get(p.job.external_task_id)
            if 상태 is None:
                나온것.append(Resumed(p, VideoOutcome.PROCESSING,
                                    message="아직 만드는 중입니다."))
                continue
            나온것.append(self._settle(prov, p, 상태, dest_for, policy, sleep))
        return 나온것

    def _settle(self, prov: Any, p: Pending, 상태: VideoJobState,
                dest_for: Callable[[Pending], Path],
                policy: RetryPolicy,
                sleep: Callable[[float], None]) -> Resumed:
        if 상태.outcome is VideoOutcome.FAILED:
            self._db.update_job(p.job_id, status="failed")
            return Resumed(p, VideoOutcome.FAILED,
                           message=상태.error or "그 장면을 만들지 못했습니다.")
        if 상태.outcome is not VideoOutcome.SUCCEEDED:
            self._db.update_job(p.job_id, status="processing")
            return Resumed(p, 상태.outcome, message="아직 만드는 중입니다.")

        # 다 됐으면 **곧바로** 내려받습니다. 주소는 30일 뒤 사라집니다.
        try:
            난것 = run_with_retry(lambda: prov.download(상태, dest_for(p)),
                                policy=policy, sleep=sleep)
        except ProviderError as e:
            self._db.update_job(p.job_id, status="processing")
            return Resumed(p, VideoOutcome.SUCCEEDED, message=e.user_message)
        except Exception:
            self._db.update_job(p.job_id, status="processing")
            return Resumed(p, VideoOutcome.SUCCEEDED,
                           message="영상을 받아오지 못했습니다. 다시 눌러 주세요.")

        self._db.update_job(p.job_id, status="succeeded")
        return Resumed(p, VideoOutcome.SUCCEEDED, path=Path(난것),
                       message="받아왔습니다.")

    def _give_up(self, p: Pending) -> Resumed:
        """30일이 지난 것. **파일은 건드리지 않고** 상태만 바꿉니다."""
        self._db.update_job(p.job_id, status="failed", error_code="expired")
        return Resumed(
            p, VideoOutcome.FAILED,
            message=f"맡긴 지 {int(RESULT_LIFETIME_DAYS)}일이 지나 결과가 지워졌습니다. "
                    "그 장면은 다시 만들어야 합니다.")
