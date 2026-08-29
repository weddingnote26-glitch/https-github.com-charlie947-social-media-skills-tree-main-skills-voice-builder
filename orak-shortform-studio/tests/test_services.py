"""서비스 계층 시험 — 단계별 실패 처리 · 주제 · 사례 · 성과.

가장 중요한 것: **한 단계가 실패해도 앱이 죽지 않고, 그 단계만 다시 할 수 있다.**
영상 만들기는 한 번에 몇백 원씩 나갑니다. 처음부터 다시 하면 또 냅니다.

    python tests/test_services.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.contracts.errors import ProviderError, Retry  # noqa: E402
from app.core.db import Database  # noqa: E402
from app.services.pipeline import (  # noqa: E402
    STEP_ORDER,
    Production,
    Step,
    StepStatus,
)
from app.services.research import (  # noqa: E402
    CompetitorAnalysisService,
    PerformanceAnalysisService,
    TopicDiscoveryService,
)


def _db() -> Database:
    return Database(Path(tempfile.mkdtemp()) / "t.sqlite3")


def _터짐(exc: Exception):
    def go():
        raise exc
    return go


# ── 단계별 실패 ──────────────────────────────────────────


def test_한_단계가_실패해도_나머지는_그대로다() -> None:
    p = Production()
    p.run(Step.SCRIPT, lambda: "대본입니다")
    p.run(Step.IMAGE, _터짐(RuntimeError("무언가 터짐")))
    p.run(Step.VOICE, lambda: "소리입니다")

    assert p.state(Step.SCRIPT).status is StepStatus.DONE
    assert p.state(Step.IMAGE).status is StepStatus.FAILED
    assert p.state(Step.VOICE).status is StepStatus.DONE
    assert p.result(Step.SCRIPT) == "대본입니다", "앞 단계 결과가 날아갔습니다"


def test_실패해도_예외가_밖으로_안_나간다() -> None:
    """예외가 새면 창이 통째로 닫힙니다."""
    p = Production()
    for 터질것 in (RuntimeError("x"), ValueError("y"), KeyError("z"),
                 OSError("파일 없음")):
        st = p.run(Step.IMAGE, _터짐(터질것))
        assert st.status is StepStatus.FAILED


def test_실패_메시지에_개발자_말이_없다() -> None:
    """§9 · 보안 원칙 — traceback 과 원문 오류를 화면에 올리지 않습니다."""
    p = Production()
    st = p.run(Step.VOICE,
               _터짐(RuntimeError("Traceback: xi-api-key=sk-REALSECRET 401")))
    for 금지 in ("Traceback", "RuntimeError", "sk-REALSECRET", "401", "xi-api-key"):
        assert 금지 not in st.message, f"{금지} 가 화면 글에 있습니다: {st.message}"
    assert "목소리" in st.message and "실패" in st.message


def test_공급자가_준_한국어를_그대로_보여준다() -> None:
    p = Production()
    st = p.run(Step.SCRIPT, _터짐(ProviderError(
        retry=Retry.BACKOFF, user_message="인터넷 연결을 확인한 뒤 다시 눌러 주세요.",
        log_detail="sk-secret 401 detail", provider="openai")))
    assert st.message == "인터넷 연결을 확인한 뒤 다시 눌러 주세요."
    assert "sk-secret" not in st.message
    assert st.can_retry is True


def test_다시_해도_소용없는_것은_다시_하라고_안_한다() -> None:
    """설정이 잘못된 것을 계속 다시 누르게 하면 돈만 나갑니다."""
    p = Production()
    st = p.run(Step.SCRIPT, _터짐(ProviderError(
        retry=Retry.NEVER_PARAM, user_message="모델을 골라주세요.",
        log_detail="", provider="openai")))
    assert st.can_retry is False


def test_그_단계만_다시_한다() -> None:
    p = Production()
    p.run(Step.SCRIPT, lambda: "대본")
    p.run(Step.IMAGE, _터짐(RuntimeError("x")))
    부른횟수 = {"대본": 0}

    def 대본만들기():
        부른횟수["대본"] += 1
        return "대본"

    p.retry(Step.SCRIPT, 대본만들기)
    assert 부른횟수["대본"] == 0, "이미 끝난 단계를 또 불렀습니다 (돈이 두 번 나갑니다)"

    p.retry(Step.IMAGE, lambda: "이미지")
    assert p.state(Step.IMAGE).status is StepStatus.DONE
    assert p.state(Step.IMAGE).attempts == 2


def test_건너뛴_단계는_실패가_아니다() -> None:
    p = Production()
    p.run(Step.VOICE, lambda: "x", skip_if=True)
    assert p.state(Step.VOICE).status is StepStatus.SKIPPED
    assert p.failed == []


def test_단계_순서가_지시서대로다() -> None:
    assert [s.value for s in STEP_ORDER] == [
        "topic", "competitor", "plan", "script", "image", "voice",
        "video", "caption", "save"]


def test_상태_요약에_한국어만_나온다() -> None:
    p = Production()
    p.run(Step.SCRIPT, lambda: "x")
    p.run(Step.IMAGE, _터짐(RuntimeError("boom")))
    글 = p.summary()
    assert "대본 만들기: 완료" in 글
    assert "이미지 만들기: 실패" in 글
    for 금지 in ("done", "failed", "waiting", "RuntimeError", "boom"):
        assert 금지 not in 글, 금지


# ── 주제 발굴 ────────────────────────────────────────────


def test_주제를_넣고_읽는다() -> None:
    svc = TopicDiscoveryService(_db())
    svc.add("신림 6천원 칼국수", source="지역이슈", memo="가격이 화제")
    있는것 = svc.list()
    assert len(있는것) == 1 and 있는것[0].title == "신림 6천원 칼국수"
    assert 있는것[0].used is False
    svc.mark_used(있는것[0].idea_id)
    assert svc.list()[0].used is True


def test_빈_주제는_거절한다() -> None:
    svc = TopicDiscoveryService(_db())
    try:
        svc.add("   ")
    except ValueError:
        pass
    else:
        raise AssertionError("빈 주제를 받았습니다")


def test_붙인_것이_없으면_후보를_안_지어낸다() -> None:
    """§0-4 — 여기서 웹을 뒤지지 않습니다."""
    assert TopicDiscoveryService(_db()).suggest("신림 맛집") == []


def test_나중에_공식_API를_붙일_자리가_있다() -> None:
    svc = TopicDiscoveryService(_db(), fetch_hook=lambda kw: [f"{kw} 후보1"])
    assert svc.suggest("신림") == ["신림 후보1"]


# ── 경쟁 사례 ────────────────────────────────────────────


def test_사례를_적어_둔다() -> None:
    svc = CompetitorAnalysisService(_db())
    svc.add("youtube", url="https://example.invalid/w", note="첫 3초가 좋다")
    있는것 = svc.list()
    assert len(있는것) == 1
    assert 있는것[0].platform_label == "유튜브"


def test_모르는_곳은_거절한다() -> None:
    svc = CompetitorAnalysisService(_db())
    for 나쁜것 in ("트위터", "", "facebook"):
        try:
            svc.add(나쁜것, note="x")
        except ValueError:
            pass
        else:
            raise AssertionError(f"{나쁜것!r} 를 받았습니다")


def test_주소도_메모도_없으면_거절한다() -> None:
    svc = CompetitorAnalysisService(_db())
    try:
        svc.add("blog")
    except ValueError:
        pass
    else:
        raise AssertionError("빈 사례를 받았습니다")


def test_사례_요약에_주소가_안_들어간다() -> None:
    """§0-4 — 주소를 AI 에게 넘기면 열어보려 할 수 있습니다."""
    svc = CompetitorAnalysisService(_db())
    svc.add("instagram", url="https://example.invalid/p/SECRETPATH",
            note="가격을 먼저 보여준다")
    글 = svc.summary_for_prompt()
    assert "가격을 먼저 보여준다" in 글
    assert "SECRETPATH" not in 글 and "http" not in 글


def test_사례가_없으면_빈_글이다() -> None:
    assert CompetitorAnalysisService(_db()).summary_for_prompt() == ""


# ── 성과 ────────────────────────────────────────────────


def test_성과를_넣고_고칠_거리를_받는다() -> None:
    db = _db()
    pid = db.create_project(store_name="가게", folder_path="/tmp/x")
    svc = PerformanceAnalysisService(db)
    svc.add(project_id=pid, views=300, saves=1, shares=0, comments=0)
    말 = svc.hints(pid)
    assert any("조회수" in m for m in 말)
    assert any("저장" in m for m in 말)


def test_수치가_고르면_그렇다고_말한다() -> None:
    db = _db()
    pid = db.create_project(store_name="가게", folder_path="/tmp/x")
    svc = PerformanceAnalysisService(db)
    svc.add(project_id=pid, views=10000, saves=300, shares=100, comments=50)
    assert svc.hints(pid) == ["수치가 고르게 나왔습니다. 이 구성을 유지해 보세요."]


def test_넣은_수치가_없으면_그렇다고_말한다() -> None:
    db = _db()
    pid = db.create_project(store_name="가게", folder_path="/tmp/x")
    assert PerformanceAnalysisService(db).hints(pid) == ["아직 넣은 수치가 없습니다."]


def test_성과는_손으로_넣는다() -> None:
    """§0-4 — 자동 수집하지 않습니다."""
    글 = (Path(__file__).resolve().parent.parent / "app" / "services"
          / "research.py").read_text(encoding="utf-8")
    for 금지 in ("graph.facebook", "instagram.com/api", "requests.get", "urlopen"):
        assert 금지 not in 글, f"자동 수집 코드가 있습니다: {금지}"


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
