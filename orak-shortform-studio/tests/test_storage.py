"""저장 시험 — Stage 3.

완료 기준: **키를 저장한 뒤 다시 실행해도 읽히고, 로그에 안 남음.**

    python tests/test_storage.py

DPAPI 는 윈도우 전용이라 여기서는 시험용 잠금장치를 끼워 넣고 흐름만 확인합니다.
진짜 DPAPI 확인은 사장님 PC 에서 해야 합니다.
"""

from __future__ import annotations

import json
import sys
import tempfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.contracts.models import JobType, RenderMode, SceneStatus  # noqa: E402
from app.core import masking  # noqa: E402
from app.core.db import Database, SecretInSettings  # noqa: E402
from app.core.masking import MASK, Masker  # noqa: E402
from app.core.paths import Paths, WriteNotAllowed, safe_folder_name  # noqa: E402
from app.core.secrets import (  # noqa: E402
    CredentialStore,
    InsecureTestCipher,
    MemorySecretStore,
    SecretStore,
    VaultUnavailable,
    open_vault,
)

REAL_KEY = "sk-ant-api03-THIS-MUST-NEVER-APPEAR-IN-ANY-OUTPUT"


def _tmp() -> Path:
    return Path(tempfile.mkdtemp())


def _paths() -> Paths:
    p = Paths(data_root=_tmp() / "ORAK_SHORTFORM_STUDIO")
    p.ensure_layout()
    return p


# ═════════════════════════════════════════════════════════════
# 마스킹 (§10-3 이 단위시험을 명시적으로 요구한 부분)
# ═════════════════════════════════════════════════════════════


def test_등록한_열쇠는_어디에_적어도_안_나온다() -> None:
    m = Masker()
    m.register(REAL_KEY)
    담아본곳 = [
        f"인증 실패 key={REAL_KEY}",
        f"{{'api_key': '{REAL_KEY}'}}",
        f"Authorization: Bearer {REAL_KEY}",
        f"...{REAL_KEY}...",
        REAL_KEY,
        f"{REAL_KEY}{REAL_KEY}",
    ]
    for text in 담아본곳:
        assert REAL_KEY not in m.scrub(text), f"새어 나갔습니다: {text[:40]}"


def test_등록하지_않아도_열쇠처럼_생기면_지운다() -> None:
    """새 서비스를 붙이고 등록을 깜빡한 경우를 대비한 그물입니다."""
    m = Masker()   # 아무것도 등록하지 않음
    열쇠들 = [
        "sk-ant-api03-abcdefghijklmnop",
        "sk_1234567890abcdefghij",
        "AIzaSyD-1234567890abcdefghijklmnopqrs",
        "sk-proj-abcdefghijklmnopqrstuv",
    ]
    for key in 열쇠들:
        assert MASK in m.scrub(f"값은 {key} 입니다"), f"못 잡았습니다: {key}"
        assert key not in m.scrub(key)


def test_헤더는_이름만_남기고_값을_지운다() -> None:
    """어느 열쇠가 문제인지는 알아야 고칠 수 있습니다."""
    m = Masker()
    결과 = m.scrub("xi-api-key: elevenlabs_secret_abcdefghijkl")
    assert "xi-api-key" in 결과, "어느 헤더인지는 남아야 합니다"
    assert "elevenlabs_secret" not in 결과


def test_멀쩡한_글은_건드리지_않는다() -> None:
    """지나치게 지우면 로그가 쓸모없어집니다."""
    m = Masker()
    m.register(REAL_KEY)
    그대로여야 = [
        "영상 생성에 실패했습니다.",
        "이번 달 누적 21,000원 / 50,000원",
        "1080x1920 · 30fps · 23초",
        "신림 맛집 · 할머니 손칼국수 6,000원",
        "assets/character_profile.json 을 읽었습니다",
        "장면 3 을 다시 만듭니다",
        "20260901_할머니손칼국수",
        "짙은 갈색 체크(타탄) · 사냥모자 모양",
    ]
    for text in 그대로여야:
        assert m.scrub(text) == text, f"멀쩡한 글이 지워졌습니다: {text!r}"


def test_짧은_값은_등록해도_무시한다() -> None:
    """"1234" 를 등록하면 멀쩡한 글에서 숫자가 사라집니다."""
    m = Masker()
    m.register("1234")
    assert m.registered_count == 0
    assert m.scrub("가격은 1234원입니다") == "가격은 1234원입니다"


def test_문자열이_아닌_것도_받는다() -> None:
    """예외 객체나 사전을 그대로 넘겨도 새지 않아야 합니다."""
    m = Masker()
    m.register(REAL_KEY)
    assert REAL_KEY not in m.scrub({"key": REAL_KEY})
    assert REAL_KEY not in m.scrub(ValueError(REAL_KEY))
    assert REAL_KEY not in m.scrub([REAL_KEY])


def test_두번_지워도_같다() -> None:
    m = Masker()
    m.register(REAL_KEY)
    한번 = m.scrub(f"key={REAL_KEY}")
    assert m.scrub(한번) == 한번


def test_깨끗한지_물어볼_수_있다() -> None:
    m = Masker()
    m.register(REAL_KEY)
    assert m.is_clean("영상을 만들었습니다") is True
    assert m.is_clean(f"key={REAL_KEY}") is False


# ═════════════════════════════════════════════════════════════
# 폴더와 쓰기 가드 (분리규칙 §2)
# ═════════════════════════════════════════════════════════════


def test_기본_폴더를_만든다() -> None:
    p = _paths()
    for name in ("Projects", "Settings", "Assets", "Logs"):
        assert (p.data_root() / name).is_dir(), f"{name} 폴더가 없습니다"


def test_프로젝트_폴더는_덮어쓰지_않는다() -> None:
    """같은 이름이 있으면 _2, _3 을 붙입니다 (§0-1 3번)."""
    p = _paths()
    a = p.new_project_dir("할머니 손칼국수", on=date(2026, 9, 1))
    b = p.new_project_dir("할머니 손칼국수", on=date(2026, 9, 1))
    c = p.new_project_dir("할머니 손칼국수", on=date(2026, 9, 1))
    assert [x.name for x in (a, b, c)] == [
        "20260901_할머니손칼국수", "20260901_할머니손칼국수_2", "20260901_할머니손칼국수_3"]
    assert a.exists() and b.exists(), "먼저 만든 폴더가 사라지면 안 됩니다"


def test_프로젝트_안에_하위폴더가_생긴다() -> None:
    d = _paths().new_project_dir("오첨지 순대국")
    있어야 = {"source", "script", "images", "videos", "audio", "subtitle", "final"}
    assert {x.name for x in d.iterdir()} == 있어야


def test_상대_프로그램_폴더에는_쓸_수_없다() -> None:
    """분리규칙 §2 — A(당근 카드뉴스)의 모든 폴더는 접근 금지."""
    p = _paths()
    금지 = [
        r"C:\Users\USER\Desktop\오락_당근_콘텐츠\content\a.json",
        r"C:\Users\USER\Desktop\오락_당근_배포도구\src\b.py",
        r"C:\Users\USER\Desktop\오락_당근_콘텐츠\_공용\used_topics.json",
    ]
    for path in 금지:
        assert not p.is_writable(Path(path)), f"뚫렸습니다: {path}"


def test_바탕화면_전체가_막혀있다() -> None:
    p = _paths()
    for path in (Path.home() / "Desktop" / "x.txt",
                 Path(r"C:\Users\USER\Desktop\오락이 마스터 파일\01.png"),
                 Path(r"C:\Users\USER\Desktop\아무거나.txt")):
        assert not p.is_writable(path), f"바탕화면이 뚫렸습니다: {path}"


def test_동봉_자산은_읽기전용이다() -> None:
    p = _paths()
    assert not p.is_writable(p.bundled_assets_dir() / "master" / "01.png")
    assert not p.is_writable(p.bundled_assets_dir() / "character_profile.json")


def test_이름이_비슷한_옆폴더는_안된다() -> None:
    """문자열 앞부분만 비교하면 옆 폴더가 통과합니다."""
    p = _paths()
    옆 = p.data_root().parent / (p.data_root().name + "2") / "x.txt"
    assert not p.is_writable(옆), f"옆 폴더가 뚫렸습니다: {옆}"


def test_써도_되는_곳은_허용한다() -> None:
    p = _paths()
    for path in (p.db_path(), p.credentials_path(), p.log_file(),
                 p.projects_dir() / "x" / "final" / "out.mp4"):
        assert p.is_writable(path), f"막히면 안 됩니다: {path}"


def test_막힐때_한국어로_알려준다() -> None:
    p = _paths()
    try:
        p.assert_writable(Path(r"C:\Users\USER\Desktop\오락_당근_콘텐츠\a.txt"))
    except WriteNotAllowed as e:
        assert "오락_당근_콘텐츠" in e.reason
    else:  # pragma: no cover
        raise AssertionError("막히지 않았습니다")


def test_폴더이름을_다듬는다() -> None:
    assert safe_folder_name("오첨지/순대국") == "오첨지순대국"
    assert safe_folder_name('A:B*C?"<>|') == "ABC"
    assert safe_folder_name("   ") == "이름없음"
    assert safe_folder_name("할머니 손칼국수") == "할머니손칼국수"


def test_지우는_기능이_없다() -> None:
    """분리규칙 §3-3 — 파일을 지우는 코드를 쓰지 마세요."""
    import app.core.db as db_mod
    import app.core.paths as paths_mod
    import app.core.secrets as secrets_mod

    for mod in (paths_mod, db_mod, secrets_mod):
        src = Path(mod.__file__).read_text(encoding="utf-8")
        for 금지 in ("shutil.rmtree", "os.remove", "os.unlink", "os.rmdir",
                     "DROP TABLE", "DELETE FROM"):
            assert 금지 not in src, f"{Path(mod.__file__).name} 에 {금지} 가 있습니다"


# ═════════════════════════════════════════════════════════════
# 열쇠 금고 (§10-3 · MVP 판정 18번)
# ═════════════════════════════════════════════════════════════


def _vault(path: Path, masker: Masker | None = None) -> CredentialStore:
    return CredentialStore(path, InsecureTestCipher(), masker=masker)


def test_저장한_뒤_다시_켜도_읽힌다() -> None:
    """Stage 3 완료 기준입니다."""
    path = _paths().credentials_path()
    _vault(path).put("claude", REAL_KEY)

    다시켬 = _vault(path, masker=Masker())      # 새 객체 = 프로그램 재시작
    꺼낸것 = 다시켬.get("claude")
    assert 꺼낸것 is not None, "다시 켰더니 열쇠가 없습니다"
    assert 꺼낸것.reveal() == REAL_KEY


def test_금고파일에_평문이_없다() -> None:
    """MVP 판정 18번 — 직접 뒤져서 확인합니다."""
    path = _paths().credentials_path()
    _vault(path).put("claude", REAL_KEY)

    raw = path.read_bytes()
    assert REAL_KEY.encode() not in raw, "금고 파일에 평문이 그대로 있습니다"
    assert b"sk-ant" not in raw, "열쇠 앞부분이 보입니다"


def test_금고에_넣으면_로그에서_저절로_지워진다() -> None:
    """읽는 순간 마스커에 등록되므로, 그 뒤로는 어디에 적어도 안 샙니다."""
    m = Masker()
    path = _paths().credentials_path()
    _vault(path).put("claude", REAL_KEY)

    읽는금고 = _vault(path, masker=m)
    assert m.scrub(f"key={REAL_KEY}") != f"key={REAL_KEY}", "등록 전인데 지워졌습니다"
    읽는금고.get("claude")                     # 여기서 등록됨
    assert REAL_KEY not in m.scrub(f"실패 key={REAL_KEY}")


def test_화면에는_가려진_형태만_보인다() -> None:
    path = _paths().credentials_path()
    v = _vault(path)
    v.put("claude", REAL_KEY)
    hint = v.hint("claude")
    assert hint == f"sk-...{MASK}", hint
    assert REAL_KEY not in hint
    assert v.hint("없는열쇠") == "아직 넣지 않았습니다"


def test_어떤_열쇠가_있는지만_알려준다() -> None:
    path = _paths().credentials_path()
    v = _vault(path)
    v.put("claude", REAL_KEY)
    v.put("kling", "kling-token-abcdefghijkl")
    assert v.names() == ["claude", "kling"]
    assert REAL_KEY not in str(v.names()), "이름 목록에 값이 섞이면 안 됩니다"


def test_빈_값은_저장하지_않는다() -> None:
    v = _vault(_paths().credentials_path())
    for 나쁜값 in ("", "   "):
        try:
            v.put("claude", 나쁜값)
        except ValueError:
            pass
        else:  # pragma: no cover
            raise AssertionError(f"빈 값이 저장됐습니다: {나쁜값!r}")


def test_윈도우가_아니면_안전한척하지_않고_멈춘다() -> None:
    """평문으로 흘리느니 안 되는 게 낫습니다."""
    if sys.platform == "win32":  # pragma: no cover
        return
    try:
        open_vault(_paths().credentials_path())
    except VaultUnavailable as e:
        assert "윈도우" in e.user_message
    else:  # pragma: no cover
        raise AssertionError("리눅스에서 금고가 열렸습니다")


def test_금고가_깨져도_파일을_지우지_않는다() -> None:
    path = _paths().credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"MANGLED-NOT-OURS")

    try:
        _vault(path).get("claude")
    except VaultUnavailable as e:
        assert "다시 넣어주세요" in e.user_message
        assert REAL_KEY not in str(e)
    else:  # pragma: no cover
        raise AssertionError("깨진 파일인데 그냥 읽혔습니다")
    assert path.exists(), "읽기 실패했다고 파일을 지우면 안 됩니다"


# ═════════════════════════════════════════════════════════════
# 저장소 (§10-2)
# ═════════════════════════════════════════════════════════════


def _db() -> Database:
    return Database(_paths().db_path(), masker=Masker())


def test_표가_다섯개다() -> None:
    assert _db().table_names() == [
        "generation_jobs", "project_urls", "projects", "scenes", "settings"]


def test_프로젝트와_장면을_넣고_읽는다() -> None:
    db = _db()
    pid = db.create_project(store_name="할머니 손칼국수", folder_path="/x",
                            area="신림", price="6,000원", is_paid_promotion=True)
    for i, mode in enumerate(
            [RenderMode.KLING, RenderMode.KENBURNS, RenderMode.KENBURNS,
             RenderMode.KLING, RenderMode.KENBURNS], start=1):
        db.add_scene(pid, idx=i, start_sec=i, end_sec=i + 3, render_mode=mode)

    p = db.get_project(pid)
    assert p["store_name"] == "할머니 손칼국수"
    assert p["is_paid_promotion"] == 1
    scenes = db.scenes(pid)
    assert len(scenes) == 5
    assert [s["idx"] for s in scenes] == [1, 2, 3, 4, 5]
    assert sum(1 for s in scenes if s["render_mode"] == "kling") == 2


def test_한_장면이_실패해도_다른_장면은_그대로다() -> None:
    """§10-2 — 실패한 Scene 만 다시 만들 수 있어야 합니다."""
    db = _db()
    pid = db.create_project(store_name="골목 만둣집", folder_path="/x")
    ids = [db.add_scene(pid, idx=i, start_sec=0, end_sec=3,
                        render_mode=RenderMode.KENBURNS) for i in range(1, 6)]
    for sid in ids:
        db.set_scene_status(sid, SceneStatus.COMPLETED)

    db.set_scene_status(ids[2], SceneStatus.FAILED,
                        error_msg="이 장면은 만들 수 없습니다.", bump_retry=True)

    scenes = db.scenes(pid)
    assert len(scenes) == 5, "장면이 사라졌습니다"
    실패 = [s for s in scenes if s["status"] == "failed"]
    완료 = [s for s in scenes if s["status"] == "completed"]
    assert len(실패) == 1 and len(완료) == 4
    assert 실패[0]["retry_count"] == 1


def test_실패_문구에도_마스킹이_걸린다() -> None:
    m = Masker()
    m.register(REAL_KEY)
    db = Database(_paths().db_path(), masker=m)
    pid = db.create_project(store_name="x", folder_path="/x")
    sid = db.add_scene(pid, idx=1, start_sec=0, end_sec=3,
                       render_mode=RenderMode.KLING)
    db.set_scene_status(sid, SceneStatus.FAILED, error_msg=f"실패 key={REAL_KEY}")
    assert REAL_KEY not in db.scenes(pid)[0]["error_msg"]


def test_참고주소는_저장만_된다() -> None:
    """§0-4 — 프로그램이 열지 않습니다. 표에도 글자로만 들어갑니다."""
    db = _db()
    pid = db.create_project(store_name="x", folder_path="/x")
    db.add_url(pid, "https://example.com/store", "담당자 메모")
    urls = db.urls(pid)
    assert urls[0]["url"] == "https://example.com/store"
    assert set(urls[0]) == {"id", "project_id", "url", "note"}, \
        "가져온 내용을 담는 칸이 있으면 안 됩니다"


def test_껐다_켜도_진행중이던_작업이_살아있다() -> None:
    """MVP 판정 12번 — 재시작 복원."""
    path = _paths().db_path()
    db = Database(path, masker=Masker())
    pid = db.create_project(store_name="청년 밥상", folder_path="/x")
    db.record_job(project_id=pid, provider="kling", job_type=JobType.VIDEO,
                  external_task_id="orak-20260901-s1", scene_idx=1,
                  status="processing", cost_estimate_krw=483)
    db.record_job(project_id=pid, provider="kling", job_type=JobType.VIDEO,
                  external_task_id="orak-20260901-s4", scene_idx=4,
                  status="succeeded", cost_estimate_krw=483)
    db.close()

    다시켬 = Database(path, masker=Masker())    # 프로그램 재시작
    남은것 = 다시켬.unfinished_video_jobs()
    assert len(남은것) == 1, "끝난 작업까지 다시 조회하려 합니다"
    j = 남은것[0]
    assert j.external_task_id == "orak-20260901-s1"
    assert j.provider == "kling" and j.scene_idx == 1


def test_이번달_누적을_더한다() -> None:
    db = _db()
    pid = db.create_project(store_name="x", folder_path="/x")
    for _ in range(2):
        db.record_job(project_id=pid, provider="kling", job_type=JobType.VIDEO,
                      cost_estimate_krw=483)
    db.record_job(project_id=pid, provider="elevenlabs", job_type=JobType.TTS,
                  cost_estimate_krw=55)
    assert db.month_to_date_krw() == 483 * 2 + 55


def test_설정표에_열쇠를_넣으면_거부한다() -> None:
    """§10-2 — settings 표에 API 키를 저장하지 않습니다."""
    m = Masker()
    m.register(REAL_KEY)
    db = Database(_paths().db_path(), masker=m)

    db.put_setting("환율", "1380")
    db.put_setting("월_한도_원", "50000")
    assert db.get_setting("환율") == "1380"

    for 나쁜값 in (REAL_KEY, "sk-ant-api03-abcdefghijklmnop",
                   "AIzaSyD-1234567890abcdefghijklmnopqrs"):
        try:
            db.put_setting("api_key", 나쁜값)
        except SecretInSettings:
            pass
        else:  # pragma: no cover
            raise AssertionError(f"열쇠가 설정표에 들어갔습니다: {나쁜값[:20]}")

    assert "api_key" not in db.all_settings()


def test_DB파일에_평문_열쇠가_없다() -> None:
    """MVP 판정 18번 — DB 를 직접 뒤져서 확인합니다."""
    m = Masker()
    m.register(REAL_KEY)
    path = _paths().db_path()
    db = Database(path, masker=m)
    pid = db.create_project(store_name="x", folder_path="/x")
    sid = db.add_scene(pid, idx=1, start_sec=0, end_sec=3,
                       render_mode=RenderMode.KLING)
    db.set_scene_status(sid, SceneStatus.FAILED, error_msg=f"key={REAL_KEY}")
    try:
        db.put_setting("api_key", REAL_KEY)
    except SecretInSettings:
        pass
    db.close()

    assert REAL_KEY.encode() not in path.read_bytes(), "DB 파일에 평문이 있습니다"


def test_설정파일_자체에도_열쇠가_없다() -> None:
    """assets 의 설정 파일들도 훑어봅니다."""
    root = Path(__file__).resolve().parent.parent
    for f in sorted((root / "assets").glob("*.json")):
        text = f.read_text(encoding="utf-8")
        assert masking.default_masker().is_clean(text), f"{f.name} 에 열쇠가 있습니다"
        json.loads(text)


# ═════════════════════════════════════════════════════════════
# 금고 인터페이스 · 지우기 · 비윈도우 안전
# ═════════════════════════════════════════════════════════════


def test_두_금고가_같은_계약을_지킨다() -> None:
    """화면과 공급자는 인터페이스만 봅니다. 어느 쪽을 끼워도 돌아야 합니다."""
    for store in (_vault(_paths().credentials_path()), MemorySecretStore()):
        assert isinstance(store, SecretStore), type(store).__name__


def test_열쇠를_지울_수_있다() -> None:
    for store in (_vault(_paths().credentials_path()), MemorySecretStore()):
        store.put("claude", REAL_KEY)
        assert store.has("claude")
        assert store.delete("claude") is True
        assert store.has("claude") is False
        assert store.get("claude") is None
        assert store.delete("claude") is False, "없는 열쇠를 지우면 False 여야 합니다"


def test_지워도_금고파일은_남는다() -> None:
    """분리규칙 §3-3 — 파일을 지우는 코드를 쓰지 않습니다."""
    path = _paths().credentials_path()
    v = _vault(path)
    v.put("claude", REAL_KEY)
    v.put("kling", "kling-token-abcdefghijkl")
    assert v.delete("claude") is True
    assert path.exists(), "항목 하나 지웠다고 파일을 지우면 안 됩니다"

    다시켬 = _vault(path, masker=Masker())
    assert 다시켬.names() == ["kling"], "지운 건 사라지고 남은 건 살아 있어야 합니다"


def test_지운_뒤_파일에도_안_남는다() -> None:
    path = _paths().credentials_path()
    v = _vault(path)
    v.put("claude", REAL_KEY)
    v.delete("claude")
    assert REAL_KEY.encode() not in path.read_bytes()


def test_비윈도우에서_import만으로_죽지_않는다() -> None:
    """pywin32 가 없는 곳에서도 프로그램 전체가 불러와져야 합니다.

    ``win32crypt`` 를 파일 맨 위에서 import 하면 리눅스·맥에서 즉시 죽습니다.
    ``DpapiCipher.__init__`` 안에서만 import 합니다.
    """
    import importlib

    for name in ("app.core.secrets", "app.core.db", "app.core.paths",
                 "app.core.masking", "app.ui.screens.settings", "app.main"):
        importlib.import_module(name)      # 죽으면 여기서 실패합니다

    src = Path(__file__).resolve().parent.parent / "app" / "core" / "secrets.py"
    for line in src.read_text(encoding="utf-8").splitlines():
        if line.startswith("import ") or line.startswith("from "):
            assert "win32" not in line, f"맨 위에서 import 하면 안 됩니다: {line}"


def test_로그파일에_열쇠가_안_남는다() -> None:
    """실제로 로그 파일을 써 보고 뒤져봅니다 (§10-3 · MVP 판정 18번)."""
    import logging

    m = Masker()
    m.register(REAL_KEY)
    paths = _paths()
    log_path = paths.log_file()
    paths.assert_writable(log_path)

    logger = logging.getLogger("orak.test.log")
    logger.handlers.clear()
    logger.setLevel(logging.DEBUG)
    handler = logging.FileHandler(log_path, encoding="utf-8")

    class 마스킹필터(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            record.msg = m.scrub(record.getMessage())
            record.args = ()
            return True

    handler.addFilter(마스킹필터())
    logger.addHandler(handler)

    logger.info("인증 실패 key=%s", REAL_KEY)
    logger.error(f"Authorization: Bearer {REAL_KEY}")
    logger.debug(str({"api_key": REAL_KEY}))
    try:
        raise ValueError(f"boom {REAL_KEY}")
    except ValueError as exc:
        logger.warning(m.scrub(exc))
    handler.close()
    logger.handlers.clear()

    written = log_path.read_text(encoding="utf-8")
    assert written.strip(), "로그가 안 써졌습니다"
    assert REAL_KEY not in written, "로그 파일에 열쇠가 남았습니다"
    assert "sk-ant" not in written, "열쇠 앞부분이 남았습니다"
    assert MASK in written, "가려진 흔적이 있어야 합니다"


def test_DB에_열쇠가_평문으로_없는지_직접_뒤진다() -> None:
    """MVP 판정 18번 — 「직접 grep 으로 확인」 을 시험이 대신 합니다."""
    m = Masker()
    m.register(REAL_KEY)
    paths = _paths()
    db = Database(paths.db_path(), masker=m)
    pid = db.create_project(store_name="x", folder_path="/x")
    db.add_url(pid, f"https://example.com/?k={REAL_KEY}")
    sid = db.add_scene(pid, idx=1, start_sec=0, end_sec=3,
                       render_mode=RenderMode.KLING)
    db.set_scene_status(sid, SceneStatus.FAILED, error_msg=f"key={REAL_KEY}")
    db.close()

    _vault(paths.credentials_path()).put("claude", REAL_KEY)

    for f in paths.data_root().rglob("*"):
        if not f.is_file():
            continue
        raw = f.read_bytes()
        if f.name == "credentials.dat":
            assert REAL_KEY.encode() not in raw, "금고 파일에 평문이 있습니다"
        else:
            assert REAL_KEY.encode() not in raw, f"{f.name} 에 평문 열쇠가 있습니다"


def test_새_폴더도_만들어진다() -> None:
    p = _paths()
    for name in ("Cache", "Exports", "Temp"):
        assert (p.data_root() / name).is_dir(), f"{name} 폴더가 없습니다"
    for d in (p.cache_dir(), p.exports_dir(), p.temp_dir()):
        assert p.is_writable(d)


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
