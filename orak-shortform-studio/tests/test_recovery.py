"""다시 하기 · 껐다 켜도 이어서 시험 (Stage 10).

완료 기준: **프로그램을 껐다 켜도 이미 돈이 나간 작업을 잃어버리지 않는다.**

가장 중요한 것 둘:
  · 다시 **제출**하지 않는다 (돈을 두 번 내지 않는다)
  · 열쇠가 틀린 것은 다시 부르지 않는다 (백 번 해도 같다)

    python tests/test_recovery.py
"""

from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.contracts.errors import ProviderError, Retry  # noqa: E402
from app.contracts.models import (  # noqa: E402
    JobType,
    VideoJob,
    VideoJobState,
    VideoOutcome,
)
from app.core.db import Database  # noqa: E402
from app.core.paths import APP_DIR_NAME, FORBIDDEN_NAMES, Paths  # noqa: E402
from app.services.recovery import (  # noqa: E402
    DAY,
    RESULT_LIFETIME_DAYS,
    Pending,
    RecoveryService,
    RetryPolicy,
    run_with_retry,
)

DAY_SEC = 86400.0


def _db() -> Database:
    return Database(Path(tempfile.mkdtemp()) / "t.sqlite3")


def _err(retry: Retry, msg: str = "잠시 뒤에 다시 시도합니다.") -> ProviderError:
    return ProviderError(retry=retry, user_message=msg, log_detail="",
                         provider="kling")


# ═════════════════════════════════════════════════════════
# 다시 하기
# ═════════════════════════════════════════════════════════


def test_잠깐_막힌_것만_다시_부른다() -> None:
    번 = {"n": 0}

    def 일():
        번["n"] += 1
        if 번["n"] < 3:
            raise _err(Retry.BACKOFF)
        return "됐다"

    잔것: list[float] = []
    assert run_with_retry(일, policy=RetryPolicy(jitter=0),
                          sleep=잔것.append) == "됐다"
    assert 번["n"] == 3
    assert 잔것 == [2.0, 4.0], "기다리는 시간을 늘려가지 않습니다"


def test_열쇠가_틀린_것은_다시_안_부른다() -> None:
    """백 번 해도 같습니다. 다시 부르면 시간만 버립니다."""
    for 종류 in (Retry.NEVER_AUTH, Retry.NEVER_PARAM, Retry.MANUAL):
        번 = {"n": 0}

        def 일():
            번["n"] += 1
            raise _err(종류, "사용 키에 문제가 있습니다.")

        try:
            run_with_retry(일, policy=RetryPolicy(jitter=0), sleep=lambda s: None)
        except ProviderError as e:
            assert e.retry is 종류
        else:
            raise AssertionError(f"{종류} 인데 통과했습니다")
        assert 번["n"] == 1, f"{종류} 를 {번['n']}번 불렀습니다"


def test_모르는_예외는_돈_드는_일을_반복하지_않는다() -> None:
    번 = {"n": 0}

    def 일():
        번["n"] += 1
        raise RuntimeError("무언가 이상함")

    try:
        run_with_retry(일, policy=RetryPolicy(jitter=0), sleep=lambda s: None)
    except RuntimeError:
        pass
    else:
        raise AssertionError("삼켰습니다")
    assert 번["n"] == 1


def test_끝까지_안_되면_마지막_이유를_올린다() -> None:
    def 일():
        raise _err(Retry.BACKOFF, "잠시 뒤에 다시 시도합니다.")

    잔것: list[float] = []
    try:
        run_with_retry(일, policy=RetryPolicy(max_attempts=3, jitter=0),
                       sleep=잔것.append)
    except ProviderError as e:
        assert e.user_message == "잠시 뒤에 다시 시도합니다."
    else:
        raise AssertionError("끝없이 다시 불렀습니다")
    assert len(잔것) == 2, "3번 부르면 2번 기다려야 합니다"


def test_기다리는_시간에_상한이_있다() -> None:
    p = RetryPolicy(base_delay_sec=2.0, max_delay_sec=10.0, jitter=0)
    assert [p.delay_for(i) for i in range(1, 7)] == [2, 4, 8, 10, 10, 10]


def test_여러_장면이_같은_순간에_몰리지_않는다() -> None:
    """다섯 장면이 동시에 다시 부르면 상대가 또 막습니다."""
    p = RetryPolicy(jitter=0.25)
    값들 = {p.delay_for(1, rand=lambda r=r: r) for r in (0.0, 0.5, 1.0)}
    assert len(값들) == 3, "전부 같은 시간에 다시 부릅니다"
    assert min(값들) >= 1.4 and max(값들) <= 2.6


# ═════════════════════════════════════════════════════════
# 껐다 켜도 이어서
# ═════════════════════════════════════════════════════════


class FakeProvider:
    """poll 과 download 만 하는 가짜. **submit 을 부르면 시험이 깨집니다.**"""

    name = "kling"

    def __init__(self, 결과: dict[str, VideoOutcome], *, 내려받기_실패=False) -> None:
        self.결과 = 결과
        self.polled: list[list[str]] = []
        self.downloaded: list[str] = []
        self.submitted: list = []
        self._실패 = 내려받기_실패

    def submit(self, req):
        self.submitted.append(req)
        raise AssertionError("이어서 하는데 다시 제출했습니다 — 돈이 두 번 나갑니다")

    def poll(self, jobs):
        self.polled.append([j.external_task_id for j in jobs])
        return [VideoJobState(job=j,
                              outcome=self.결과.get(j.external_task_id,
                                                  VideoOutcome.PROCESSING),
                              remote_url=f"https://x.invalid/{j.external_task_id}")
                for j in jobs]

    def download(self, state, dest):
        if self._실패:
            raise _err(Retry.BACKOFF, "인터넷 연결을 확인한 뒤 다시 눌러 주세요.")
        self.downloaded.append(state.job.external_task_id)
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"fake mp4")
        return dest


def _맡긴다(db, *, task="T1", days_ago=0.0, store="할머니 손칼국수", now=None):
    now = now or time.time()
    pid = db.create_project(store_name=store,
                            folder_path=str(Path(tempfile.mkdtemp()) / "p"))
    jid = db.record_job(project_id=pid, provider="kling", job_type=JobType.VIDEO,
                        external_task_id=task, scene_idx=1, status="submitted",
                        cost_estimate_krw=483)
    # 맡긴 시각을 뒤로 돌립니다 (오래된 작업 흉내)
    db._conn.execute("UPDATE generation_jobs SET request_at = ? WHERE id = ?",
                     (now - days_ago * DAY_SEC, jid))
    db._conn.commit()
    return pid, jid


def _dest(tmp: Path):
    return lambda p: tmp / f"장면{p.job.scene_idx}.mp4"


def test_껐다_켜면_맡겨_둔_작업을_찾는다() -> None:
    db = _db()
    _맡긴다(db, task="T1")
    있는것 = RecoveryService(db).pending()
    assert len(있는것) == 1
    assert 있는것[0].job.external_task_id == "T1"
    assert 있는것[0].store_name == "할머니 손칼국수"
    assert 있는것[0].expired is False


def test_이어서_할_때_다시_제출하지_않는다() -> None:
    """이게 이 기능의 핵심입니다. 다시 제출하면 483원을 또 냅니다."""
    db = _db()
    _맡긴다(db, task="T1")
    prov = FakeProvider({"T1": VideoOutcome.SUCCEEDED})
    tmp = Path(tempfile.mkdtemp())

    결과 = RecoveryService(db).resume(dest_for=_dest(tmp), provider=prov)

    assert prov.submitted == [], "다시 제출했습니다"
    assert prov.polled == [["T1"]], "손잡이로 물어보지 않았습니다"
    assert prov.downloaded == ["T1"]
    assert len(결과) == 1 and 결과[0].path is not None
    assert 결과[0].path.read_bytes() == b"fake mp4"


def test_다_된_것은_곧바로_내려받는다() -> None:
    """주소만 갖고 있으면 30일 뒤 사라집니다 (MVP 판정 20번)."""
    db = _db()
    _맡긴다(db, task="T1")
    prov = FakeProvider({"T1": VideoOutcome.SUCCEEDED})
    tmp = Path(tempfile.mkdtemp())
    RecoveryService(db).resume(dest_for=_dest(tmp), provider=prov)
    assert (tmp / "장면1.mp4").is_file()
    assert RecoveryService(db).pending() == [], "다 받았는데 아직 안 끝난 걸로 남았습니다"


def test_아직_만드는_중이면_그대로_둔다() -> None:
    db = _db()
    _맡긴다(db, task="T1")
    prov = FakeProvider({"T1": VideoOutcome.PROCESSING})
    결과 = RecoveryService(db).resume(dest_for=_dest(Path(tempfile.mkdtemp())),
                                    provider=prov)
    assert 결과[0].path is None
    assert "만드는 중" in 결과[0].message
    assert len(RecoveryService(db).pending()) == 1, "아직 안 끝났는데 목록에서 뺐습니다"


def test_여러_장면을_한_번에_물어본다() -> None:
    """조회는 동시처리 수를 쓰지 않습니다 (§2-1). 다섯 번 부를 이유가 없습니다."""
    db = _db()
    for i, t in enumerate(["T1", "T2", "T3"], start=1):
        _맡긴다(db, task=t)
    prov = FakeProvider({"T1": VideoOutcome.SUCCEEDED,
                         "T2": VideoOutcome.PROCESSING,
                         "T3": VideoOutcome.FAILED})
    결과 = RecoveryService(db).resume(dest_for=_dest(Path(tempfile.mkdtemp())),
                                    provider=prov)
    assert len(prov.polled) == 1, f"{len(prov.polled)}번 물어봤습니다"
    assert sorted(prov.polled[0]) == ["T1", "T2", "T3"]
    assert len(결과) == 3


def test_30일이_지난_것은_받으려_하지_않는다() -> None:
    """Kling 결과는 30일 뒤 지워집니다 (§2-1). 헛되이 부르지 않습니다."""
    db = _db()
    _맡긴다(db, task="T1", days_ago=31)
    prov = FakeProvider({"T1": VideoOutcome.SUCCEEDED})
    결과 = RecoveryService(db).resume(dest_for=_dest(Path(tempfile.mkdtemp())),
                                    provider=prov)
    assert prov.polled == [], "이미 지워진 것을 물어봤습니다"
    assert prov.downloaded == []
    assert 결과[0].outcome is VideoOutcome.FAILED
    assert "다시 만들어야" in 결과[0].message
    assert RecoveryService(db).pending() == [], "정리되지 않았습니다"


def test_29일된_것은_아직_받아본다() -> None:
    db = _db()
    _맡긴다(db, task="T1", days_ago=29)
    prov = FakeProvider({"T1": VideoOutcome.SUCCEEDED})
    tmp = Path(tempfile.mkdtemp())
    RecoveryService(db).resume(dest_for=_dest(tmp), provider=prov)
    assert prov.downloaded == ["T1"], "아직 살아 있는데 포기했습니다"


def test_내려받기가_실패하면_다음에_다시_할_수_있게_둔다() -> None:
    """여기서 「끝났다」 고 표시하면 이미 낸 돈이 그대로 날아갑니다."""
    db = _db()
    _맡긴다(db, task="T1")
    prov = FakeProvider({"T1": VideoOutcome.SUCCEEDED}, 내려받기_실패=True)
    결과 = RecoveryService(db).resume(
        dest_for=_dest(Path(tempfile.mkdtemp())), provider=prov,
        policy=RetryPolicy(max_attempts=2, jitter=0), sleep=lambda s: None)
    assert 결과[0].path is None
    assert len(RecoveryService(db).pending()) == 1, "실패했는데 목록에서 뺐습니다"


def test_공급자가_아직_없으면_죽지_않는다() -> None:
    """Kling 은 아직 안 붙였습니다. 그래도 프로그램이 멈추면 안 됩니다."""
    db = _db()
    _맡긴다(db, task="T1")

    def 못만듦(이름):
        raise RuntimeError("아직 안 붙임")

    결과 = RecoveryService(db, provider_for=못만듦).resume(
        dest_for=_dest(Path(tempfile.mkdtemp())))
    assert len(결과) == 1
    assert "회사에 문의" in 결과[0].message
    assert len(RecoveryService(db).pending()) == 1, "못 했는데 목록에서 뺐습니다"


def test_실패한_장면은_실패로_남는다() -> None:
    db = _db()
    _맡긴다(db, task="T1")
    prov = FakeProvider({"T1": VideoOutcome.FAILED})
    결과 = RecoveryService(db).resume(dest_for=_dest(Path(tempfile.mkdtemp())),
                                    provider=prov)
    assert 결과[0].outcome is VideoOutcome.FAILED
    assert RecoveryService(db).pending() == []


# ── 담당자에게 보여줄 글 ─────────────────────────────────


def test_알림에_개발자_말이_없다() -> None:
    db = _db()
    _맡긴다(db, task="T1")
    _맡긴다(db, task="T2", days_ago=40)
    글 = RecoveryService(db).notice()
    assert "이어서 하기" in 글
    assert "지워졌습니다" in 글
    for 금지 in ("Traceback", "HTTP", "None", "task_id", "kling", "poll"):
        assert 금지 not in 글, f"{금지} 가 화면 글에 있습니다: {글}"


def test_할_일이_없으면_알림이_없다() -> None:
    assert RecoveryService(_db()).notice() == ""


def test_한_줄_설명이_사람_말이다() -> None:
    p = Pending(job_id=1, project_id=1,
                job=VideoJob(provider="kling", scene_idx=2,
                             external_task_id="T1"),
                age_days=0.2, store_name="할머니 손칼국수")
    assert "할머니 손칼국수" in p.label and "장면 2" in p.label and "오늘" in p.label
    오래된것 = Pending(job_id=1, project_id=1,
                   job=VideoJob(provider="kling", scene_idx=2,
                                external_task_id="T1"),
                   age_days=35.0, store_name="할머니 손칼국수")
    assert 오래된것.expired is True
    assert "35일 전" in 오래된것.label and "지워졌습니다" in 오래된것.label


# ═════════════════════════════════════════════════════════
# 자료 폴더 이름 (2026-08-29 확정)
# ═════════════════════════════════════════════════════════


def test_자료_폴더가_내_문서_아래_한글_이름이다() -> None:
    assert APP_DIR_NAME == "오락 숏폼 스튜디오"
    자리 = Paths().data_root()
    assert 자리.name == APP_DIR_NAME
    assert 자리.parent.name in ("Documents", "내 문서", "문서"), 자리


def test_새_폴더_이름이_금지_목록에_안_걸린다() -> None:
    """「오락_숏폼스튜디오」(바탕화면) 와 이름이 비슷해 헷갈리기 쉽습니다.

    잘못 걸리면 자기 자료 폴더에 아무것도 못 씁니다.
    """
    assert APP_DIR_NAME not in FORBIDDEN_NAMES
    p = Paths()
    assert p.is_writable(p.projects_dir()), "자기 폴더에 못 씁니다"
    assert p.is_writable(p.data_root() / "Projects" / "20260901_할머니국수")


def test_공백이_있어도_경로가_안_깨진다() -> None:
    """폴더 이름에 띄어쓰기가 있습니다. 하위 경로가 쪼개지면 안 됩니다."""
    p = Paths()
    자리 = p.projects_dir() / "20260901_할머니국수" / "final" / "완성.mp4"
    assert p.is_writable(자리)
    assert " " in str(p.data_root()), "띄어쓰기가 사라졌습니다"
    assert 자리.parent.name == "final"


def test_바탕화면과_A폴더는_여전히_막힌다() -> None:
    p = Paths()
    for 막아야할것 in (
        r"C:\Users\USER\Desktop\오락_당근_콘텐츠\a.txt",
        r"C:\Users\USER\Desktop\오락_숏폼스튜디오\b.mp4",
        r"C:\Users\USER\Desktop\오락이 마스터 파일\c.png",
    ):
        assert not p.is_writable(Path(막아야할것)), 막아야할것


def test_예전_폴더를_옮기거나_지우지_않는다() -> None:
    """§0-1 4번 — 담당자가 만든 영상이 들어 있을 수 있습니다."""
    바탕 = Path(tempfile.mkdtemp())
    옛것 = 바탕 / "ORAK_SHORTFORM_STUDIO"
    (옛것 / "Projects").mkdir(parents=True)
    소중한것 = 옛것 / "Projects" / "완성.mp4"
    소중한것.write_text("담당자가 만든 영상", encoding="utf-8")

    p = Paths(data_root=바탕 / APP_DIR_NAME)
    p.ensure_layout()

    assert p.legacy_data_root() == 옛것, "예전 폴더를 못 찾습니다"
    assert 소중한것.read_text(encoding="utf-8") == "담당자가 만든 영상", \
        "예전 영상이 사라졌습니다"
    assert 옛것.is_dir(), "예전 폴더를 지웠습니다"


def test_예전_폴더가_없으면_없다고_한다() -> None:
    p = Paths(data_root=Path(tempfile.mkdtemp()) / APP_DIR_NAME)
    assert p.legacy_data_root() is None


def test_되살리기에_지우는_코드가_없다() -> None:
    글 = (Path(__file__).resolve().parent.parent / "app" / "services"
          / "recovery.py").read_text(encoding="utf-8")
    for 금지 in ("rmtree", "os.remove", "unlink", "DELETE FROM", "rm -rf"):
        assert 금지 not in 글, f"{금지} 가 있습니다"


if __name__ == "__main__":
    import traceback

    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    통과 = 실패 = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  통과   {name}")
            통과 += 1
        except Exception:
            print(f"  실패 ✗ {name}")
            traceback.print_exc()
            실패 += 1
    print(f"\n{통과}개 통과, {실패}개 실패 (전체 {len(tests)}개)")
    sys.exit(1 if 실패 else 0)
