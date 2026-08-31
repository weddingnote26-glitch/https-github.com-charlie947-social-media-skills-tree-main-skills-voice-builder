"""사진 넣기·컷 편집 시험 (지시서 §4 · §1-1).

담당자가 사진을 골라 장면마다 넣고, 컷 길이를 조정하는 흐름입니다.

    python tests/test_photos.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PySide6.QtWidgets import QApplication  # noqa: E402

_app = QApplication.instance() or QApplication([])

from app.contracts.models import MAX_TOTAL_SEC, RenderMode, Scene  # noqa: E402
from app.core.photos import (  # noqa: E402
    KENBURNS_MIN_PX,
    KLING_MIN_PX,
    PhotoSet,
    assignment_problems,
    auto_assign,
    inspect_photo,
)
from app.ui.photo_widgets import PhotoPicker, ScenePhotoPicker  # noqa: E402
from app.ui.screens.new_video import NewVideoScreen  # noqa: E402


def _make(name: str, size=(1600, 1200), fmt="JPEG") -> Path:
    from PIL import Image

    p = Path(tempfile.mkdtemp()) / name
    Image.new("RGB", size, (230, 210, 180)).save(p, fmt)
    return p


def _scenes() -> list[Scene]:
    return [
        Scene(idx=1, start_sec=0, end_sec=3, render_mode=RenderMode.KLING),
        Scene(idx=2, start_sec=3, end_sec=7, render_mode=RenderMode.KENBURNS),
        Scene(idx=3, start_sec=7, end_sec=12, render_mode=RenderMode.KENBURNS),
        Scene(idx=4, start_sec=12, end_sec=17, render_mode=RenderMode.KLING),
        Scene(idx=5, start_sec=17, end_sec=23, render_mode=RenderMode.KENBURNS),
    ]


# ═════════════════════════════════════════════════════════════
# 사진 검사
# ═════════════════════════════════════════════════════════════


def test_쓸_수_있는_사진을_알아본다() -> None:
    for size in [(1600, 1200), (1200, 1600), (900, 900)]:
        assert inspect_photo(_make(f"a{size[0]}.jpg", size)).ok


def test_문제를_한국어로_알려준다() -> None:
    """§9 — 개발자 말이 아니라 사람 말이어야 합니다."""
    작아 = inspect_photo(_make("작아.jpg", (100, 80)))
    assert not 작아.ok and "너무 작습니다" in 작아.problem
    assert str(KENBURNS_MIN_PX) in 작아.problem, "몇 픽셀이어야 하는지 알려줘야 합니다"

    글 = Path(tempfile.mkdtemp()) / "메모.txt"
    글.write_text("사진 아님", encoding="utf-8")
    assert "쓸 수 없는 형식" in inspect_photo(글).problem

    없음 = inspect_photo(Path("/없는/사진.jpg"))
    assert "찾지 못했습니다" in 없음.problem
    for i in (작아, 없음):
        assert "Traceback" not in i.problem and "Error" not in i.problem


def test_Kling_제약을_따로_본다() -> None:
    """§2-1 — Kling 은 300px 이상 · 1:2.5~2.5:1 만 받습니다."""
    긴것 = _make("길쭉.jpg", (3000, 400))          # 7.5:1
    assert inspect_photo(긴것, for_kling=False).ok, "사진 움직이기는 잘라 쓰면 됩니다"
    assert not inspect_photo(긴것, for_kling=True).ok, "Kling 은 못 받습니다"

    작은것 = _make("작은.jpg", (320, 320))
    assert inspect_photo(작은것, for_kling=True).ok, f"{KLING_MIN_PX}px 이상이면 됩니다"


def test_가로세로를_알려준다() -> None:
    assert inspect_photo(_make("w.jpg", (1600, 900))).orientation == "가로"
    assert inspect_photo(_make("h.jpg", (900, 1600))).orientation == "세로"
    assert inspect_photo(_make("s.jpg", (1000, 1000))).orientation == "정사각"


# ═════════════════════════════════════════════════════════════
# 사진 묶음
# ═════════════════════════════════════════════════════════════


def test_같은_사진을_두번_담지_않는다() -> None:
    a, b = _make("a.jpg"), _make("b.jpg")
    ps = PhotoSet([a, b])
    ps.add([a, b, a])
    assert len(ps) == 2


def test_순서를_바꿀_수_있다() -> None:
    """위에 있는 사진부터 장면에 들어갑니다."""
    ps = PhotoSet([_make("1.jpg"), _make("2.jpg"), _make("3.jpg")])
    assert ps.move(0, 1) and ps[0].name == "2.jpg"
    assert not ps.move(0, -1), "맨 위에서 더 위로는 못 갑니다"
    assert not ps.move(2, 1), "맨 아래에서 더 아래로도 못 갑니다"


def test_목록에서_빼도_원본은_남는다() -> None:
    """§0-1 — 사장님 파일을 지우지 않습니다."""
    a = _make("빼볼것.jpg")
    ps = PhotoSet([a])
    ps.remove(0)
    assert len(ps) == 0
    assert a.exists(), "목록에서 뺐다고 파일을 지우면 안 됩니다"


def test_프로젝트_폴더로_복사한다() -> None:
    """옮기는 게 아니라 복사입니다 (§0-1)."""
    srcs = [_make("음식1.jpg"), _make("음식2.jpg")]
    ps = PhotoSet(srcs)
    dest = Path(tempfile.mkdtemp()) / "프로젝트" / "source"
    옮김 = ps.copy_into(dest)

    assert len(옮김) == 2
    for src, dst in 옮김.items():
        assert src.exists(), "원본이 사라졌습니다"
        assert dst.is_file() and dst.stat().st_size == src.stat().st_size
        assert dst.parent == dest


def test_같은_이름이면_덮지_않는다() -> None:
    """§0-1 3번 — 덮어쓰지 말고 _2 를 붙입니다."""
    dest = Path(tempfile.mkdtemp()) / "source"
    PhotoSet([_make("같은이름.jpg")]).copy_into(dest)
    PhotoSet([_make("같은이름.jpg")]).copy_into(dest)
    이름들 = sorted(p.name for p in dest.iterdir())
    assert len(이름들) == 2, 이름들
    assert any("_2" in n for n in 이름들), 이름들


def test_문제있는_사진은_복사하지_않는다() -> None:
    ps = PhotoSet([_make("좋음.jpg"), _make("작음.jpg", (50, 50))])
    dest = Path(tempfile.mkdtemp()) / "source"
    assert len(ps.copy_into(dest)) == 1


# ═════════════════════════════════════════════════════════════
# 장면 배정
# ═════════════════════════════════════════════════════════════


def test_실제사진_장면에만_차례로_배정한다() -> None:
    scenes = _scenes()
    ps = PhotoSet([_make("1.jpg"), _make("2.jpg"), _make("3.jpg")])
    a = auto_assign(scenes, ps)

    assert a[1] is None and a[4] is None, "오락이 장면에는 사진이 안 들어갑니다"
    assert [Path(a[i]).name for i in (2, 3, 5)] == ["1.jpg", "2.jpg", "3.jpg"]
    assert assignment_problems(scenes, a) == []


def test_사진이_모자라면_알려준다() -> None:
    scenes = _scenes()
    a = auto_assign(scenes, PhotoSet([_make("하나.jpg")]))
    문제 = assignment_problems(scenes, a)
    assert 문제, "사진 3장이 필요한데 1장뿐인데 아무 말도 없습니다"
    assert "장면 3" in 문제[0] and "장면 5" in 문제[0]
    assert "사진을 더 넣으시거나" in 문제[0], "어떻게 하라는 안내가 있어야 합니다"


# ═════════════════════════════════════════════════════════════
# 화면
# ═════════════════════════════════════════════════════════════


def test_고르개가_장수를_알려준다() -> None:
    ps = PhotoSet()
    pk = PhotoPicker(ps)
    assert "아직 고른 사진이 없습니다" in pk.count_label.text()

    pk.add_paths([_make("a.jpg"), _make("b.jpg")])
    assert "2장" in pk.count_label.text()

    pk.add_paths([_make("작아.jpg", (60, 60))])
    assert "쓸 수 없습니다" in pk.count_label.text(), pk.count_label.text()


def test_버튼_글자가_잘리지_않는다() -> None:
    """버튼 너비를 좁게 고정하면 「위로」 가 「귀토」 처럼 잘립니다.

    한글은 영문보다 넓어서, 영문 기준으로 잡은 너비에 안 들어갑니다.
    """
    from PySide6.QtWidgets import QPushButton

    pk = PhotoPicker(PhotoSet([_make("a.jpg"), _make("b.jpg"), _make("c.jpg")]))
    pk.resize(800, 500)
    pk.show()
    for _ in range(6):
        _app.processEvents()

    잘림 = []
    for i in range(pk._list_lay.count()):
        row = pk._list_lay.itemAt(i).widget()
        for b in row.findChildren(QPushButton):
            if b.width() < b.sizeHint().width():
                잘림.append(f"{b.text()!r} ({b.width()}px 인데 {b.sizeHint().width()}px 필요)")
    assert not 잘림, "버튼 글자가 잘립니다:\n  " + "\n  ".join(잘림)


def test_기호_대신_한글을_쓴다() -> None:
    """▲▼ 같은 기호는 글꼴에 없으면 네모나 막대로 보입니다."""
    from PySide6.QtWidgets import QPushButton

    pk = PhotoPicker(PhotoSet([_make("a.jpg"), _make("b.jpg")]))
    글자 = [b.text() for i in range(pk._list_lay.count())
            for b in pk._list_lay.itemAt(i).widget().findChildren(QPushButton)]
    assert 글자, "버튼이 없습니다"
    for t in 글자:
        assert not any(ord(c) > 0x2000 and ord(c) < 0x3000 for c in t), \
            f"글꼴에 없을 수 있는 기호가 있습니다: {t!r}"


def test_사진_이름이_입력칸처럼_보이지_않는다() -> None:
    """QLabel 은 QFrame 을 물려받아서, QFrame {} 스타일을 그냥 쓰면
    안쪽 글자에도 테두리가 생겨 고칠 수 있는 칸처럼 보입니다."""
    from app.ui.photo_widgets import PhotoRow

    ps = PhotoSet([_make("a.jpg")])
    row = PhotoRow(ps[0], 0, 1, on_move=lambda *_: None, on_remove=lambda *_: None)
    assert row.objectName() == "PhotoRow", "이름을 붙여 선택자를 좁혀야 합니다"
    ss = row.styleSheet()
    assert "QFrame#PhotoRow" in ss, "선택자가 좁혀지지 않았습니다"
    assert "QLabel" in ss and "border: none" in ss, "안쪽 글자의 테두리를 지워야 합니다"


def test_작은_파일은_KB로_보여준다() -> None:
    """「0.0MB」 는 고장 난 것처럼 보입니다."""
    from PySide6.QtWidgets import QLabel

    from app.ui.photo_widgets import PhotoRow

    ps = PhotoSet([_make("작은.jpg", (500, 500))])
    row = PhotoRow(ps[0], 0, 1, on_move=lambda *_: None, on_remove=lambda *_: None)
    글 = " ".join(lb.text() for lb in row.findChildren(QLabel))
    assert "0.0MB" not in 글, 글
    assert "KB" in 글, 글


def test_장면_고르개로_사진을_바꾼다() -> None:
    ps = PhotoSet([_make("a.jpg"), _make("b.jpg")])
    고른것: list = []
    sp = ScenePhotoPicker(2, ps, ps.usable[0].path,
                          on_pick=lambda i, p: 고른것.append((i, p)))
    assert sp.combo.count() == 3, "「고르지 않음」 + 사진 2장"
    sp.combo.setCurrentIndex(2)
    assert 고른것 and Path(고른것[-1][1]).name == "b.jpg"
    sp.combo.setCurrentIndex(0)
    assert 고른것[-1][1] is None, "「고르지 않음」 도 골라져야 합니다"


def _screen_with_script() -> NewVideoScreen:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from test_script import GOOD, PRICING, FakeClient

    from app.providers.llm_claude import ClaudeScriptProvider

    s = NewVideoScreen(
        script_provider=ClaudeScriptProvider(client=FakeClient(GOOD), pricing=PRICING))
    for k in ("store_name", "area", "address", "menu", "price", "features", "reason"):
        s.fields[k].setText("값")
    s.photo_picker.add_paths([_make("음식1.jpg"), _make("음식2.jpg"), _make("간판.jpg")])
    s.make_script_button.click()
    _app.processEvents()
    return s


def test_대본을_만들면_사진이_저절로_배정된다() -> None:
    s = _screen_with_script()
    kb = [sc.idx for sc in s.script.scenes if sc.render_mode is RenderMode.KENBURNS]
    assert len(kb) == 3
    assert all(s.scene_photos.get(i) for i in kb), s.scene_photos
    assert len(s.scene_pickers) == 3, "실제 사진 장면에만 고르개가 붙습니다"
    assert s.check_edits() == []


def test_사진이_모자라면_만들기가_잠긴다() -> None:
    s = _screen_with_script()
    s.scene_photos[2] = None                 # 한 장면을 비워봅니다
    s.update_rule_notice()
    assert not s.produce_button.isEnabled(), "사진이 없는데 만들기가 눌립니다"
    assert "사진" in s.rule_notice.text()


def test_컷_길이를_바꾸면_뒤가_밀린다() -> None:
    """장면 사이에 빈 시간이 생기면 영상이 끊깁니다."""
    s = _screen_with_script()
    처음 = s.script.total_sec

    s.scene_lengths[1].setValue(6.0)         # 장면 1 을 3초 → 6초
    _app.processEvents()

    scenes = s.script.scenes
    assert scenes[0].end_sec == 6.0
    assert scenes[1].start_sec == 6.0, "뒤 장면이 안 밀렸습니다"
    for a, b in zip(scenes, scenes[1:]):
        assert abs(b.start_sec - a.end_sec) < 0.01, "장면 사이에 틈이 있습니다"
    assert s.script.total_sec == 처음 + 3.0


def test_30초를_넘기면_만들기가_잠긴다() -> None:
    """§8 — 자동으로 잘라내지 않고 담당자가 줄이게 합니다."""
    s = _screen_with_script()
    s.scene_lengths[1].setValue(15.0)
    _app.processEvents()
    assert s.script.total_sec > MAX_TOTAL_SEC
    assert not s.produce_button.isEnabled()
    assert "30초까지" in s.rule_notice.text()

    s.scene_lengths[1].setValue(3.0)         # 되돌리면
    _app.processEvents()
    assert s.produce_button.isEnabled(), "되돌렸는데 여전히 잠겨 있습니다"


def test_화면_시간표시가_같이_바뀐다() -> None:
    s = _screen_with_script()
    s.scene_lengths[1].setValue(5.0)
    _app.processEvents()
    assert "0초 ~ 5초" in s.scene_times[1].text()
    assert "5초 ~" in s.scene_times[2].text()


def test_사진_목록이_맛집정보에_들어간다() -> None:
    s = _screen_with_script()
    assert len(s.store_info().photo_paths) == 3


def test_화면에_개발자_말이_없다() -> None:
    """§9 — 사진 관련 화면에도 적용됩니다."""
    import re

    from PySide6.QtWidgets import QCheckBox, QLabel, QPushButton

    s = _screen_with_script()
    나쁜말 = (r"\bTraceback\b", r"\b(Exception|TypeError|ValueError)\b",
              r"\bHTTP\b", r"\bNone\b", r"\bPath\(")
    for kind in (QLabel, QPushButton, QCheckBox):
        for w in s.findChildren(kind):
            t = (w.text() or "").strip()
            for pat in 나쁜말:
                assert not re.search(pat, t), f"{pat} 가 화면에 있습니다: {t!r}"


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
