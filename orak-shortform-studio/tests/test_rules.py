"""기본 제작 필수 규칙 시험 (2026-08-29 지시).

완료 기준: **규칙을 넣고·고치고·지우고, 껐다 켜도 남아 있고,
실제 프롬프트에 섞여 들어간다.**

    python tests/test_rules.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import Database  # noqa: E402
from app.core.masking import Masker  # noqa: E402
from app.core.rules import (  # noqa: E402
    ALL_SCOPES,
    DEFAULT_RULES,
    SECTIONS,
    Rule,
    RulesRepository,
    RuleScope,
    parse_scopes,
    scopes_to_text,
)
from app.services.prompt_builder import (  # noqa: E402
    ALLOWED_LENGTH_SEC,
    Platform,
    ProductionContext,
    PromptBuilder,
)
from app.services.rules_service import ProductionRulesService  # noqa: E402


def _db(name: str = "t.sqlite3") -> Database:
    return Database(Path(tempfile.mkdtemp()) / name)


def _svc(db: Database | None = None) -> ProductionRulesService:
    s = ProductionRulesService(db or _db())
    s.ensure_seeded()
    return s


# ── 저장·조회·수정·삭제 ──────────────────────────────────


def test_규칙을_넣고_읽는다() -> None:
    svc = ProductionRulesService(_db())
    rid = svc.add("릴스 / 쇼츠 대본", "첫 문장은 질문으로 시작한다.",
                  (RuleScope.SCRIPT,))
    있는것 = svc.all()
    assert len(있는것) == 1
    assert 있는것[0].body == "첫 문장은 질문으로 시작한다."
    assert 있는것[0].scopes == (RuleScope.SCRIPT,)
    assert 있는것[0].rule_id == rid


def test_빈_규칙은_거절한다() -> None:
    svc = ProductionRulesService(_db())
    for 빈것 in ("", "   ", "\n"):
        try:
            svc.add("기타", 빈것)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{빈것!r} 를 받아들였습니다")
    assert svc.all() == []


def test_규칙을_고친다() -> None:
    svc = ProductionRulesService(_db())
    rid = svc.add("기타", "원래 내용", (RuleScope.SCRIPT,))
    svc.edit(rid, body="바꾼 내용", scopes=(RuleScope.IMAGE, RuleScope.CAPTION))
    r = svc.all()[0]
    assert r.body == "바꾼 내용"
    assert set(r.scopes) == {RuleScope.IMAGE, RuleScope.CAPTION}


def test_규칙을_켜고_끈다() -> None:
    svc = ProductionRulesService(_db())
    rid = svc.add("기타", "잠깐 꺼둘 규칙", (RuleScope.SCRIPT,))
    assert len(svc.repo.for_scope(RuleScope.SCRIPT)) == 1
    svc.set_enabled(rid, False)
    assert svc.repo.for_scope(RuleScope.SCRIPT) == [], "껐는데 반영됩니다"
    assert len(svc.all()) == 1, "끈 규칙이 사라졌습니다 — 지운 게 아닙니다"
    svc.set_enabled(rid, True)
    assert len(svc.repo.for_scope(RuleScope.SCRIPT)) == 1


def test_규칙을_지운다() -> None:
    svc = ProductionRulesService(_db())
    rid = svc.add("기타", "지울 규칙")
    svc.remove(rid)
    assert svc.all() == []


def test_껐다_켜도_남아_있다() -> None:
    """같은 파일을 다시 열어 봅니다. 프로그램을 다시 켠 것과 같습니다."""
    d = Path(tempfile.mkdtemp()) / "t.sqlite3"
    첫번째 = ProductionRulesService(Database(d))
    첫번째.ensure_seeded()
    rid = 첫번째.add("기타", "내가 넣은 규칙", (RuleScope.SCRIPT,))
    첫번째.set_enabled(rid, False)
    첫번째.auto_apply = False

    두번째 = ProductionRulesService(Database(d))
    본것 = {r.body: r for r in 두번째.all()}
    assert "내가 넣은 규칙" in 본것, "다시 켜니 규칙이 사라졌습니다"
    assert 본것["내가 넣은 규칙"].enabled is False, "꺼둔 상태가 안 남았습니다"
    assert 두번째.auto_apply is False, "자동 반영 스위치가 안 남았습니다"
    assert len(두번째.all()) == len(DEFAULT_RULES) + 1


# ── 기본 템플릿 ──────────────────────────────────────────


def test_기본_템플릿_8항목이_다_있다() -> None:
    """지시서가 적어 준 8가지가 빠짐없이 들어가야 합니다."""
    있어야할것 = ["주제 발굴", "경쟁 콘텐츠 분석", "콘텐츠 기획",
                "인스타 / 유튜브 원고", "릴스 / 쇼츠 대본", "이미지 제작",
                "게시글 제작", "성과 분석"]
    assert list(SECTIONS) == 있어야할것, SECTIONS
    svc = _svc()
    담긴것 = {r.section for r in svc.all()}
    assert 담긴것 == set(있어야할것)


def test_기본값_불러오기가_고쳐둔_것을_덮지_않는다() -> None:
    """담당자가 고쳐 둔 문장을 날리면 안 됩니다."""
    svc = _svc()
    처음 = len(svc.all())
    내것 = svc.add("기타", "우리 가게만의 규칙")
    svc.set_enabled(svc.all()[0].rule_id, False)

    새로넣은수 = svc.load_defaults()
    assert 새로넣은수 == 0, "이미 있는 것을 또 넣었습니다"
    assert len(svc.all()) == 처음 + 1
    assert any(r.body == "우리 가게만의 규칙" for r in svc.all())
    assert svc.all()[0].enabled is False, "꺼둔 것을 다시 켰습니다"


def test_다_지운_뒤_다시_켜도_되살아나지_않는다() -> None:
    """일부러 다 지웠는데 켤 때마다 되살아나면 지울 수가 없습니다."""
    d = Path(tempfile.mkdtemp()) / "t.sqlite3"
    첫번째 = ProductionRulesService(Database(d))
    첫번째.ensure_seeded()
    for r in 첫번째.all():
        첫번째.remove(r.rule_id)
    assert 첫번째.all() == []

    두번째 = ProductionRulesService(Database(d))
    assert 두번째.ensure_seeded() == 0
    assert 두번째.all() == [], "지운 규칙이 되살아났습니다"


# ── 어디에 반영할지 ──────────────────────────────────────


def test_작업별로_다른_규칙이_간다() -> None:
    svc = _svc()
    대본 = {r.body for r in svc.repo.for_scope(RuleScope.SCRIPT)}
    이미지 = {r.body for r in svc.repo.for_scope(RuleScope.IMAGE)}
    게시글 = {r.body for r in svc.repo.for_scope(RuleScope.CAPTION)}
    assert 대본 and 이미지 and 게시글
    assert 대본 != 이미지, "대본과 이미지에 같은 규칙이 갑니다"
    assert "15초 길이로 만들 수 있다." in 대본
    assert "15초 길이로 만들 수 있다." not in 이미지, "대본 규칙이 이미지에도 갑니다"
    assert "해시태그를 넣는다." in 게시글
    assert "해시태그를 넣는다." not in 대본


def test_전체공통은_모든_작업에_간다() -> None:
    svc = ProductionRulesService(_db())
    svc.add("기타", "어디에나 지킬 것", ALL_SCOPES)
    for s in ALL_SCOPES:
        assert any(r.body == "어디에나 지킬 것" for r in svc.repo.for_scope(s)), s


def test_저장된_글자가_낡아도_죽지_않는다() -> None:
    """예전 판이 남긴 이름이나 오타가 있어도 앱이 멈추면 안 됩니다."""
    assert parse_scopes("script,image") == (RuleScope.SCRIPT, RuleScope.IMAGE)
    assert parse_scopes("all") == ALL_SCOPES
    assert parse_scopes("") == ALL_SCOPES, "빈 값은 전체 공통으로 봅니다"
    assert parse_scopes("모르는것,script") == (RuleScope.SCRIPT,)
    assert parse_scopes("모르는것뿐") == ALL_SCOPES
    assert scopes_to_text(ALL_SCOPES) == "all"
    assert scopes_to_text((RuleScope.SCRIPT,)) == "script"


# ── 프롬프트에 실제로 들어가는가 ─────────────────────────


def test_규칙이_프롬프트에_섞인다() -> None:
    """이게 이 기능의 전부입니다. 메모로만 남으면 아무 소용이 없습니다."""
    svc = _svc()
    svc.add("릴스 / 쇼츠 대본", "가격은 반드시 말한다.", (RuleScope.SCRIPT,))
    글 = svc.prompt_for(RuleScope.SCRIPT,
                        ProductionContext(topic="신림 손칼국수", area="신림동"))
    assert "가격은 반드시 말한다." in 글, "넣은 규칙이 프롬프트에 없습니다"
    assert "신림 손칼국수" in 글
    assert "신림동" in 글
    assert "해시태그를 넣는다." not in 글, "게시글 규칙이 대본 프롬프트에 섞였습니다"


def test_자동반영을_끄면_규칙이_빠진다() -> None:
    svc = _svc()
    ctx = ProductionContext(topic="주제")
    assert "릴스" in svc.prompt_for(RuleScope.SCRIPT, ctx) or \
           "장면 단위로 나눈다." in svc.prompt_for(RuleScope.SCRIPT, ctx)
    svc.auto_apply = False
    글 = svc.prompt_for(RuleScope.SCRIPT, ProductionContext(topic="주제"))
    assert "장면 단위로 나눈다." not in 글, "껐는데 규칙이 들어갑니다"
    assert "주제" in 글, "규칙만 빠져야지 담당자 입력까지 빠지면 안 됩니다"


def test_이번_한_번만_쓸_규칙을_넣을_수_있다() -> None:
    svc = _svc()
    ctx = ProductionContext(topic="주제", extra_rules=("오늘은 비 오는 날 분위기로",))
    글 = svc.prompt_for(RuleScope.SCRIPT, ctx)
    assert "오늘은 비 오는 날 분위기로" in 글
    assert not any(r.body == "오늘은 비 오는 날 분위기로" for r in svc.all()), \
        "임시 규칙이 저장됐습니다"


def test_미리보기와_실제로_가는_글이_같다() -> None:
    """미리보기가 실제와 다르면 믿을 수 없습니다."""
    svc = _svc()
    ctx = ProductionContext(topic="주제")
    미리 = svc.preview(RuleScope.SCRIPT, ctx)
    실제 = svc.prompt_for(RuleScope.SCRIPT, ProductionContext(topic="주제"))
    assert 미리 in 실제, "미리보기 글이 실제 프롬프트에 그대로 들어가지 않습니다"


def test_규칙이_하나도_없으면_빈_글이_간다() -> None:
    svc = ProductionRulesService(_db())
    글 = svc.prompt_for(RuleScope.SCRIPT, ProductionContext(topic="주제"))
    assert "주제" in 글
    assert "[대본을 쓸 때 지킬 것]" not in 글, "빈 제목만 덩그러니 갑니다"
    assert "반영될 규칙이 없습니다" in svc.preview(RuleScope.SCRIPT,
                                              ProductionContext())


def test_길이는_15초나_30초로만_간다() -> None:
    for 넣은것, 나올것 in ((15, 15), (30, 30), (22, 15), (28, 30), (99, 30), (0, 15)):
        assert ProductionContext(length_sec=넣은것).normalized_length() == 나올것, 넣은것
    assert ALLOWED_LENGTH_SEC == (15, 30)


def test_플랫폼이_프롬프트에_한국어로_나온다() -> None:
    b = PromptBuilder()
    for p, 나올것 in ((Platform.INSTAGRAM, "인스타그램"), (Platform.YOUTUBE, "유튜브")):
        assert 나올것 in b.context_block(ProductionContext(platform=p))


# ── 보안 (§0-3 · MVP 판정 18번) ──────────────────────────


def test_규칙에_열쇠를_붙여넣어도_평문으로_안_남는다() -> None:
    """담당자가 실수로 토큰이 든 문장을 붙여넣을 수 있습니다."""
    db = _db()
    svc = ProductionRulesService(db)
    svc.add("기타", "우리 열쇠는 sk-ant-api03-REALSECRETVALUE1234567890 입니다")
    글 = Path(db.path).read_bytes().decode("utf-8", errors="replace")
    assert "REALSECRETVALUE" not in 글, "규칙에 넣은 열쇠가 평문으로 남았습니다"
    assert "★" in svc.all()[0].body


def test_보통_한국어는_안_가려진다() -> None:
    svc = ProductionRulesService(_db())
    svc.add("주제 발굴", "할머니 손칼국수는 6,000원이고 도보 5분 거리다.")
    assert svc.all()[0].body == "할머니 손칼국수는 6,000원이고 도보 5분 거리다."


def test_규칙은_열쇠와_다른_표에_있다() -> None:
    db = _db()
    ProductionRulesService(db).ensure_seeded()
    assert "rulesets" in db.table_names()
    설정값 = " ".join(db.all_settings().values())
    assert "장면 단위로 나눈다" not in 설정값, "규칙이 settings 표에 섞였습니다"


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
