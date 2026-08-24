# -*- coding: utf-8 -*-
"""
네이버 블로그 도우미 — 창 하나짜리 윈도우 앱.

콘솔 창이 뜨지 않습니다. 모든 안내는 이 창 안에서 보여 줍니다.
"""
from __future__ import annotations

import datetime as _dt
import sys
import traceback
from pathlib import Path

from PySide6.QtCore import QSettings, Qt
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (
    QApplication, QButtonGroup, QHBoxLayout, QLabel, QMainWindow,
    QPushButton, QStackedWidget, QVBoxLayout, QWidget,
)

from . import __version__, theme
from .runner import PROJECT_ROOT, open_folder
from .screens import (
    AccountScreen, HelpScreen, HistoryScreen, HomeScreen,
    ImageScreen, PublishScreen, SettingsScreen, WriteScreen,
)
from .widgets import error

APP_NAME = "네이버 블로그 도우미"
LOG_DIR = PROJECT_ROOT / "logs"

MENU = [
    ("홈", HomeScreen),
    ("계정 연결", AccountScreen),
    ("글 작성", WriteScreen),
    ("이미지 관리", ImageScreen),
    ("예약·발행", PublishScreen),
    ("발행 내역", HistoryScreen),
    ("설정", SettingsScreen),
    ("도움말", HelpScreen),
]


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(f"{APP_NAME}  {__version__}")
        self.setMinimumSize(1000, 700)
        self.resize(1280, 860)

        icon = PROJECT_ROOT / "icon.ico"
        if icon.exists():
            self.setWindowIcon(QIcon(str(icon)))

        root = QWidget()
        self.setCentralWidget(root)
        h = QHBoxLayout(root)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(0)

        # ── 왼쪽 메뉴 ───────────────────────────────────────
        side = QWidget()
        side.setObjectName("SideBar")
        side.setFixedWidth(250)
        sv = QVBoxLayout(side)
        sv.setContentsMargins(14, 20, 14, 20)
        sv.setSpacing(6)

        brand = QLabel(APP_NAME)
        brand.setStyleSheet(
            f"font-size: {theme.FONT_BASE + 3}px; font-weight: bold;"
            f"color: {theme.PRIMARY}; padding: 6px 10px 16px 10px;")
        brand.setWordWrap(True)
        sv.addWidget(brand)

        self.group = QButtonGroup(self)
        self.group.setExclusive(True)
        self.stack = QStackedWidget()
        self.screens: dict[str, object] = {}

        for i, (name, cls) in enumerate(MENU):
            b = QPushButton(name)
            b.setCheckable(True)
            b.setCursor(Qt.PointingHandCursor)
            self.group.addButton(b, i)
            sv.addWidget(b)
            scr = cls(self)
            self.screens[name] = scr
            self.stack.addWidget(scr)

        sv.addStretch(1)
        log_btn = QPushButton("기록 폴더 열기")
        log_btn.setCursor(Qt.PointingHandCursor)
        log_btn.clicked.connect(lambda: open_folder(LOG_DIR))
        sv.addWidget(log_btn)

        h.addWidget(side)
        h.addWidget(self.stack, 1)

        self.group.idClicked.connect(self._switch)
        self.group.button(0).setChecked(True)
        self._switch(0)

        # 창 크기·위치를 기억합니다.
        self.qs = QSettings("ORAK", "NaverBlogHelper")
        geo = self.qs.value("geometry")
        if geo:
            self.restoreGeometry(geo)
        last = self.qs.value("screen")
        if isinstance(last, str) and last in self.screens:
            self.go(last)

    # ── 화면 전환 ───────────────────────────────────────────
    def _switch(self, idx: int) -> None:
        self.stack.setCurrentIndex(idx)
        scr = self.stack.currentWidget()
        if hasattr(scr, "refresh"):
            scr.refresh()

    def go(self, name: str) -> None:
        for i, (n, _) in enumerate(MENU):
            if n == name:
                self.group.button(i).setChecked(True)
                self._switch(i)
                return

    def refresh_all(self) -> None:
        scr = self.stack.currentWidget()
        if hasattr(scr, "refresh"):
            scr.refresh()

    def closeEvent(self, e) -> None:  # noqa: N802
        self.qs.setValue("geometry", self.saveGeometry())
        idx = self.group.checkedId()
        if 0 <= idx < len(MENU):
            self.qs.setValue("screen", MENU[idx][0])
        super().closeEvent(e)


# ── 예상치 못한 오류를 검은 화면 대신 안내창으로 ─────────────
def _write_crash_log(text: str) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"오류기록_{_dt.datetime.now():%Y-%m-%d_%H%M%S}.log"
    p.write_text(text, encoding="utf-8")
    return p


def _install_excepthook(win: MainWindow | None) -> None:
    def hook(kind, value, tb):
        text = "".join(traceback.format_exception(kind, value, tb))
        path = _write_crash_log(text)
        error(win,
              "예상치 못한 문제가 생겼습니다.\n\n"
              "프로그램은 계속 쓰실 수 있습니다.\n"
              f"자세한 내용은 아래 파일에 적었습니다.\n\n{path}",
              text)
    sys.excepthook = hook


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName("ORAK")
    app.setStyleSheet(theme.stylesheet())

    icon = PROJECT_ROOT / "icon.ico"
    if icon.exists():
        app.setWindowIcon(QIcon(str(icon)))

    # ── 두 번 실행되지 않게 ─────────────────────────────────
    from PySide6.QtCore import QSharedMemory
    guard = QSharedMemory("NaverBlogHelper-단일실행")
    if not guard.create(1):
        from PySide6.QtWidgets import QMessageBox
        m = QMessageBox()
        m.setIcon(QMessageBox.Information)
        m.setWindowTitle(APP_NAME)
        m.setText("이미 실행 중입니다.\n\n작업 표시줄에서 열려 있는 창을 확인해 주세요.")
        m.setStyleSheet(f"QLabel {{ font-size: {theme.FONT_BASE}px; }}")
        m.exec()
        return 0

    try:
        win = MainWindow()
    except Exception:  # noqa: BLE001
        text = traceback.format_exc()
        path = _write_crash_log(text)
        error(None, "프로그램을 시작하지 못했습니다.\n\n"
                    f"자세한 내용은 아래 파일에 적었습니다.\n\n{path}", text)
        return 1

    _install_excepthook(win)
    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
