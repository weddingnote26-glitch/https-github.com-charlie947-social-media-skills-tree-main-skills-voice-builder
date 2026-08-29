"""창 하나 · 왼쪽 메뉴 4개 · 아래 비용 표시줄.

지시서 §9: 메뉴는 **딱 4개**입니다. 늘리지 마세요.
    새 영상 만들기 · 작업 목록 · 캐릭터 · 설정
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QButtonGroup,
    QMainWindow,
    QPushButton,
    QStackedWidget,
    QWidget,
)

from app.ui import theme
from app.ui.screens.character import CharacterScreen
from app.ui.screens.job_list import JobListScreen
from app.ui.screens.new_video import NewVideoScreen
from app.ui.screens.settings import SettingsScreen
from app.ui.widgets import CostBar, hbox, label, vbox

MENU = ["새 영상 만들기", "작업 목록", "캐릭터", "설정"]


class MainWindow(QMainWindow):
    def __init__(self, db=None, registry=None) -> None:
        """``db`` 를 주면 설정 화면이 규칙과 모델 선택을 함께 씁니다.

        안 주면 화면은 그대로 뜨되 규칙은 「아직 불러오지 않았습니다」 로 보입니다.
        시험이 데이터베이스 없이도 창을 띄울 수 있어야 해서 이렇게 두었습니다.
        """
        super().__init__()
        self.db = db
        self.registry = registry
        self.recovery = None
        if db is not None:
            from app.services.recovery import RecoveryService

            self.recovery = RecoveryService(
                db,
                provider_for=(
                    (lambda 이름: registry.photo_video_provider()
                     if 이름 == "kenburns" else registry.video_provider())
                    if registry is not None else None))
        self.setWindowTitle("오락 숏폼 AI 스튜디오")
        self.resize(theme.WINDOW_W, theme.WINDOW_H)

        root = QWidget()
        root.setObjectName("Root")
        root.setStyleSheet(theme.stylesheet())
        self.setCentralWidget(root)

        outer = vbox(root, pad=0, gap=0)

        # 위: 왼쪽 메뉴 + 오른쪽 화면
        top = QWidget()
        top_lay = hbox(top, pad=0, gap=0)
        outer.addWidget(top, 1)

        top_lay.addWidget(self._build_sidebar())

        self.stack = QStackedWidget()
        self.screens = {
            "새 영상 만들기": NewVideoScreen(),
            "작업 목록": JobListScreen(db=db, recovery=self.recovery),
            "캐릭터": CharacterScreen(),
            "설정": SettingsScreen(db=db, registry=registry),
        }
        for name in MENU:
            self.stack.addWidget(self.screens[name])
        top_lay.addWidget(self.stack, 1)

        # 아래: 비용 표시줄 (§11 — 항상 보입니다)
        self.cost_bar = CostBar()
        outer.addWidget(self.cost_bar)

        self.show_menu(0)

    def _build_sidebar(self) -> QWidget:
        side = QWidget()
        side.setObjectName("Sidebar")
        side.setFixedWidth(theme.SIDEBAR_W)
        lay = vbox(side, pad=16, gap=6)

        brand = label("오락 숏폼", name="BrandName", wrap=False)
        sub = label("만두탐정 오락이", name="BrandSub", wrap=False)
        lay.addWidget(brand)
        lay.addWidget(sub)
        lay.addSpacing(18)

        self.menu_group = QButtonGroup(self)
        self.menu_group.setExclusive(True)
        self.menu_buttons: list[QPushButton] = []
        for i, name in enumerate(MENU):
            b = QPushButton(name)
            b.setObjectName("MenuButton")
            b.setCheckable(True)
            b.setCursor(Qt.PointingHandCursor)
            b.clicked.connect(lambda _=False, idx=i: self.show_menu(idx))
            self.menu_group.addButton(b, i)
            self.menu_buttons.append(b)
            lay.addWidget(b)

        lay.addStretch(1)
        lay.addWidget(label("인스타그램에는\n직접 올려주세요", name="BrandSub"))
        return side

    def show_menu(self, index: int) -> None:
        """메뉴를 고른다. 시험도 이 문으로 화면을 바꾼다."""
        self.stack.setCurrentIndex(index)
        self.menu_buttons[index].setChecked(True)

    @property
    def current_menu(self) -> str:
        return MENU[self.stack.currentIndex()]
