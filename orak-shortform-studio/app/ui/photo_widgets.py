"""사진 고르기·배정 화면 조각 (지시서 §4).

담당자는 사진을 여러 장 고르고, 어느 장면에 넣을지 정합니다.
**원본은 읽기만 합니다.** 목록에서 빼도 파일은 그대로 있습니다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional

from PySide6.QtCore import QSize, Qt
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QFrame,
    QLabel,
    QPushButton,
    QWidget,
)

from app.core.photos import PhotoInfo, PhotoSet
from app.ui import theme
from app.ui.widgets import hbox, label, vbox

THUMB = QSize(96, 96)
FILE_FILTER = "사진 (*.jpg *.jpeg *.png *.webp *.bmp)"


def load_thumb(path: Path, size: QSize = THUMB) -> Optional[QPixmap]:
    """작은 미리보기를 만듭니다. 못 읽으면 None."""
    img = QImage(str(path))
    if img.isNull():
        return None
    return QPixmap.fromImage(
        img.scaled(size, Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation))


def _placeholder(size: QSize, text: str = "?") -> QLabel:
    lb = QLabel(text)
    lb.setFixedSize(size)
    lb.setAlignment(Qt.AlignCenter)
    lb.setStyleSheet(
        f"background: {theme.CARD_ALT}; color: {theme.INK_FAINT};"
        f" border: 1px dashed {theme.LINE_STRONG}; border-radius: 6px;")
    return lb


def thumb_label(path: Path, size: QSize = THUMB) -> QLabel:
    pm = load_thumb(path, size)
    if pm is None:
        return _placeholder(size, "못 읽음")
    lb = QLabel()
    lb.setFixedSize(size)
    lb.setPixmap(pm)
    lb.setScaledContents(False)
    lb.setAlignment(Qt.AlignCenter)
    lb.setStyleSheet(f"border: 1px solid {theme.LINE}; border-radius: 6px;")
    return lb


class PhotoRow(QFrame):
    """고른 사진 한 장. 미리보기 · 이름 · 크기 · [위][아래][빼기]."""

    def __init__(self, info: PhotoInfo, index: int, total: int, *,
                 on_move: Callable[[int, int], None],
                 on_remove: Callable[[int], None]) -> None:
        super().__init__()
        # 이름을 붙여 **이 위젯에만** 적용합니다.
        # QLabel 은 QFrame 을 물려받아서, 그냥 QFrame {} 을 쓰면
        # 안쪽 글자에도 테두리가 생겨 입력칸처럼 보입니다.
        self.setObjectName("PhotoRow")
        self.setStyleSheet(
            f"QFrame#PhotoRow {{ background: {theme.CARD}; border: 1px solid "
            f"{theme.BAD if not info.ok else theme.LINE}; border-radius: 8px; }}"
            f"QFrame#PhotoRow QLabel {{ border: none; background: transparent; }}")
        lay = hbox(self, pad=10, gap=12)

        lay.addWidget(thumb_label(info.path))

        가운데 = QWidget()
        cl = vbox(가운데, pad=0, gap=3)
        이름 = label(info.name, wrap=False)
        이름.setStyleSheet(f"font-size: {theme.FS_BODY}px; font-weight: 600;")
        cl.addWidget(이름)
        if info.ok:
            크기 = (f"{info.size_mb:.1f}MB" if info.size_mb >= 1
                    else f"{info.size_mb * 1024:.0f}KB")
            cl.addWidget(label(
                f"{info.width}×{info.height} · {info.orientation} · {크기}",
                name="Hint", wrap=False))
        else:
            문제 = label(info.problem)
            문제.setStyleSheet(f"font-size: {theme.FS_SMALL}px; color: {theme.BAD};")
            cl.addWidget(문제)
        lay.addWidget(가운데, 1)

        # 「▲▼」 같은 기호는 글꼴에 없으면 네모로 보입니다. 한글로 씁니다.
        for text, step, enabled in (("위로", -1, index > 0),
                                    ("아래로", +1, index < total - 1)):
            b = QPushButton(text)
            b.setObjectName("Secondary")
            # 너비를 고정하지 않습니다. 버튼 좌우 여백이 20px 씩이라
            # 좁게 고정하면 「위로」 가 「귀토」 처럼 잘립니다.
            b.setEnabled(enabled)
            b.clicked.connect(lambda _=False, s=step: on_move(index, s))
            lay.addWidget(b)

        빼기 = QPushButton("빼기")
        빼기.setObjectName("Secondary")
        빼기.clicked.connect(lambda _=False: on_remove(index))
        lay.addWidget(빼기)


class PhotoPicker(QWidget):
    """사진 고르기 + 목록 (§4).

    ``on_change`` 는 목록이 바뀔 때마다 불립니다.
    """

    def __init__(self, photos: PhotoSet, *,
                 on_change: Optional[Callable[[], None]] = None) -> None:
        super().__init__()
        self.photos = photos
        self._on_change = on_change
        self._lay = vbox(self, pad=0, gap=10)

        머리 = hbox()
        고르기 = QPushButton("사진 고르기")
        고르기.setObjectName("Secondary")
        고르기.clicked.connect(self.choose)
        머리.addWidget(고르기)
        self.count_label = label("", name="Hint", wrap=False)
        머리.addWidget(self.count_label)
        머리.addStretch(1)
        self._lay.addLayout(머리)

        self.list_box = QWidget()
        self._list_lay = vbox(self.list_box, pad=0, gap=8)
        self._lay.addWidget(self.list_box)

        self.refresh()

    # ── 고르기 ────────────────────────────────────────────
    def choose(self) -> None:
        paths, _ = QFileDialog.getOpenFileNames(
            self, "음식·매장 사진 고르기", "", FILE_FILTER)
        if paths:
            self.add_paths([Path(p) for p in paths])

    def add_paths(self, paths: list[Path]) -> None:
        """파일 대화상자를 거치지 않고 담습니다. 시험이 이 문을 씁니다."""
        self.photos.add(paths)
        self.refresh()

    def _move(self, index: int, step: int) -> None:
        self.photos.move(index, step)
        self.refresh()

    def _remove(self, index: int) -> None:
        self.photos.remove(index)      # 목록에서만 뺍니다. 원본은 그대로.
        self.refresh()

    # ── 다시 그리기 ───────────────────────────────────────
    def refresh(self) -> None:
        while self._list_lay.count():
            item = self._list_lay.takeAt(0)
            if w := item.widget():
                w.setParent(None)

        n, 쓸수있음 = len(self.photos), len(self.photos.usable)
        if n == 0:
            self.count_label.setText("아직 고른 사진이 없습니다")
        elif 쓸수있음 == n:
            self.count_label.setText(f"{n}장 골랐습니다")
        else:
            self.count_label.setText(f"{n}장 중 {n - 쓸수있음}장은 쓸 수 없습니다")

        for i, info in enumerate(self.photos):
            self._list_lay.addWidget(
                PhotoRow(info, i, n, on_move=self._move, on_remove=self._remove))

        if self._on_change:
            self._on_change()


class ScenePhotoPicker(QWidget):
    """장면 하나에 넣을 사진 고르기.

    실제 사진 장면(kenburns)에만 붙습니다.
    오락이 장면은 그림을 만들어 쓰므로 사진이 필요 없습니다.
    """

    def __init__(self, scene_idx: int, photos: PhotoSet,
                 current: Optional[Path], *,
                 on_pick: Callable[[int, Optional[Path]], None]) -> None:
        super().__init__()
        self.scene_idx = scene_idx
        self.photos = photos
        self._on_pick = on_pick

        lay = hbox(self, pad=0, gap=12)
        self.thumb = _placeholder(QSize(72, 72), "사진\n없음")
        lay.addWidget(self.thumb)

        오른쪽 = QWidget()
        rl = vbox(오른쪽, pad=0, gap=4)
        rl.addWidget(label("이 장면에 넣을 사진", name="Hint", wrap=False))
        self.combo = QComboBox()
        self.combo.addItem("— 고르지 않음 —", None)
        for info in photos.usable:
            self.combo.addItem(info.name, str(info.path))
        self.combo.currentIndexChanged.connect(self._changed)
        rl.addWidget(self.combo)
        lay.addWidget(오른쪽, 1)

        self.set_current(current)

    def set_current(self, path: Optional[Path]) -> None:
        idx = self.combo.findData(str(path) if path else None)
        self.combo.setCurrentIndex(max(idx, 0))
        self._update_thumb(path)

    def _changed(self) -> None:
        data = self.combo.currentData()
        path = Path(data) if data else None
        self._update_thumb(path)
        self._on_pick(self.scene_idx, path)

    def _update_thumb(self, path: Optional[Path]) -> None:
        새것 = (thumb_label(path, QSize(72, 72)) if path
                else _placeholder(QSize(72, 72), "사진\n없음"))
        self.layout().replaceWidget(self.thumb, 새것)
        self.thumb.setParent(None)
        self.thumb = 새것
