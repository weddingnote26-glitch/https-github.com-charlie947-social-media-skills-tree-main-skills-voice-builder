"""작업 목록 — 만든 영상과 만들다 만 것을 봅니다.

Stage 10 에서 **껐다 켜도 이어서 하기**를 붙였습니다.
프로그램이 꺼져도 이미 돈이 나간 작업은 그대로 남아 있습니다.
다시 켜면 여기서 찾아 결과를 받아옵니다 — **다시 제출하지 않습니다.**

기록을 넘겨주지 않으면(`db=None`) 예시 표를 보여주고 예시라고 말합니다.
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

from app.core.paths import APP_DIR_NAME
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
    def __init__(self, db=None, recovery=None) -> None:
        super().__init__()
        self.db = db
        self.recovery = recovery
        lay = vbox(self, pad=theme.PAD_L)
        lay.addWidget(label("작업 목록", name="ScreenTitle"))
        lay.addWidget(label("만든 영상과 만들다 만 것이 모두 여기 남습니다. 자동으로 지우지 않습니다.",
                            name="ScreenSub"))

        # ── 껐다 켜도 이어서 (Stage 10) ──
        #
        # 이미 **돈이 나간** 작업입니다. 다시 제출하지 않고 결과만 받아옵니다.
        self.resume_box = None
        self.resume_button = None
        알림 = self.recovery.notice() if self.recovery is not None else ""
        if 알림:
            self.resume_box = NoticeBox(알림, tone="warn",
                                        title="지난번에 하던 일이 있습니다")
            lay.addWidget(self.resume_box)
            줄 = hbox()
            줄.addStretch(1)
            self.resume_button = QPushButton("이어서 하기")
            self.resume_button.clicked.connect(self._resume)
            줄.addWidget(self.resume_button)
            lay.addLayout(줄)
        self.resume_state = label("", name="Hint")
        self.resume_state.setVisible(False)
        lay.addWidget(self.resume_state)

        rows = self._rows()
        if self.db is None:
            lay.addWidget(NoticeBox(
                "아래는 화면을 보여드리기 위한 예시입니다. 실제 기록이 아닙니다.",
                tone="info", title="아직 예시입니다"))

        c = card()
        cl = vbox(c, pad=16)

        self.table = QTableWidget(len(rows), len(COLUMNS))
        self.table.setHorizontalHeaderLabels(COLUMNS)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setAlternatingRowColors(False)

        for r, (date, store, area, length, status, color) in enumerate(rows):
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
            f"만든 영상은 「내 문서 › {APP_DIR_NAME} › Projects」 안에 있습니다.",
            name="Hint", wrap=False))
        foot.addStretch(1)
        open_folder = QPushButton("저장 폴더 열기")
        open_folder.setObjectName("Secondary")
        foot.addWidget(open_folder)
        lay.addLayout(foot)

    # ── 기록 읽기 ─────────────────────────────────────────
    def _rows(self):
        """진짜 기록. 없으면 예시를 씁니다."""
        if self.db is None:
            return SAMPLE_ROWS

        import time
        from datetime import datetime

        상태글 = {"completed": ("완료", theme.OK),
                "failed": ("실패", theme.BAD),
                "producing": ("만드는 중", theme.WARN),
                "scripted": ("대본까지", theme.WARN),
                "draft": ("쓰다 만 것", theme.INK_SOFT)}
        나온것 = []
        for p in self.db.list_projects():
            언제 = datetime.fromtimestamp(
                float(p.get("created_at") or time.time())).strftime("%Y-%m-%d")
            글, 색 = 상태글.get(p.get("status", ""), ("만드는 중", theme.WARN))
            나온것.append((언제, p.get("store_name", ""), p.get("area", ""),
                        "—", 글, 색))
        return 나온것

    # ── 이어서 하기 ───────────────────────────────────────
    def _resume(self) -> None:
        """맡겨 둔 작업의 결과를 받아옵니다. **다시 제출하지 않습니다.**"""
        if self.recovery is None:
            return
        if self.resume_button is not None:
            self.resume_button.setEnabled(False)
        self.resume_state.setText("받아오는 중입니다…")
        self.resume_state.setVisible(True)
        try:
            결과 = self.recovery.resume(dest_for=self._dest_for)
        except Exception:
            # 여기서 예외가 새면 창이 닫힙니다 (§9).
            결과 = []
            self.resume_state.setText("이어서 하지 못했습니다. 다시 눌러 주세요.")
        else:
            받은것 = sum(1 for r in 결과 if r.path is not None)
            self.resume_state.setText(
                f"{받은것}개를 받아왔습니다." if 받은것
                else (결과[0].message if 결과 else "받아올 것이 없습니다."))
        finally:
            if self.resume_button is not None:
                self.resume_button.setEnabled(True)

    def _dest_for(self, pending):
        """받아온 영상을 놓을 자리. 그 프로젝트의 videos 폴더입니다."""
        from pathlib import Path

        바탕 = Path(pending.folder_path) if pending.folder_path else Path(".")
        return 바탕 / "videos" / f"장면{pending.job.scene_idx}.mp4"
