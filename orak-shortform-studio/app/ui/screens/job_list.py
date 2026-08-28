"""작업 목록 — 만든 영상과 만들다 만 것을 봅니다.

⚠️ Stage 2 입니다. 아래 표는 예시이며 실제 기록이 아닙니다.
진짜 목록은 Stage 3(SQLite) 이후에 붙습니다.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QHeaderView,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QWidget,
)

from app.ui import theme
from app.ui.widgets import NoticeBox, card, hbox, label, vbox

COLUMNS = ["만든 날", "매장", "지역", "길이", "상태", ""]

SAMPLE_ROWS = [
    ("2026-09-01", "할머니 손칼국수", "신림", "23초", "완료", theme.OK),
    ("2026-09-01", "오첨지 순대국", "봉천", "26초", "완료", theme.OK),
    ("2026-08-31", "골목 만둣집", "서울대입구", "—", "장면 3 실패", theme.BAD),
    ("2026-08-30", "청년 밥상", "신림", "—", "만드는 중", theme.WARN),
]


class JobListScreen(QWidget):
    def __init__(self) -> None:
        super().__init__()
        lay = vbox(self, pad=theme.PAD_L)
        lay.addWidget(label("작업 목록", name="ScreenTitle"))
        lay.addWidget(label("만든 영상과 만들다 만 것이 모두 여기 남습니다. 자동으로 지우지 않습니다.",
                            name="ScreenSub"))
        lay.addWidget(NoticeBox(
            "아래는 화면을 보여드리기 위한 예시입니다. 실제 기록이 아닙니다.",
            tone="info", title="아직 예시입니다"))

        c = card()
        cl = vbox(c, pad=16)

        self.table = QTableWidget(len(SAMPLE_ROWS), len(COLUMNS))
        self.table.setHorizontalHeaderLabels(COLUMNS)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setAlternatingRowColors(False)

        for r, (date, store, area, length, status, color) in enumerate(SAMPLE_ROWS):
            self.table.setRowHeight(r, 52)
            for col, text in enumerate((date, store, area, length)):
                item = QTableWidgetItem(text)
                item.setTextAlignment(Qt.AlignVCenter | Qt.AlignLeft)
                self.table.setItem(r, col, item)
            st = QTableWidgetItem(status)
            st.setForeground(QColor(color))
            font = st.font()
            font.setBold(True)
            st.setFont(font)
            st.setTextAlignment(Qt.AlignVCenter | Qt.AlignLeft)
            self.table.setItem(r, 4, st)

            # 버튼이 칸 테두리에 닿지 않도록 여백을 준 껍데기에 담습니다.
            holder = QWidget()
            hl = hbox(holder, pad=0, gap=0)
            hl.setContentsMargins(6, 6, 10, 6)
            btn = QPushButton("열기" if status == "완료" else "이어서")
            btn.setObjectName("Secondary")
            hl.addWidget(btn)
            self.table.setCellWidget(r, 5, holder)

        head = self.table.horizontalHeader()
        head.setDefaultAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        for i in range(len(COLUMNS) - 1):
            head.setSectionResizeMode(i, QHeaderView.Stretch)
        head.setSectionResizeMode(len(COLUMNS) - 1, QHeaderView.Fixed)
        self.table.setColumnWidth(len(COLUMNS) - 1, 116)
        cl.addWidget(self.table)
        lay.addWidget(c, 1)

        foot = hbox()
        foot.addWidget(label(
            "만든 영상은 「내 문서 › ORAK_SHORTFORM_STUDIO › Projects」 안에 있습니다.",
            name="Hint", wrap=False))
        foot.addStretch(1)
        open_folder = QPushButton("저장 폴더 열기")
        open_folder.setObjectName("Secondary")
        foot.addWidget(open_folder)
        lay.addLayout(foot)
