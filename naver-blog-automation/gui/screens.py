# -*- coding: utf-8 -*-
"""화면 8개 — 홈 · 계정 연결 · 글 작성 · 이미지 관리 · 예약·발행 · 발행 내역 · 설정 · 도움말."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QGridLayout, QHBoxLayout, QHeaderView, QLabel,
    QScrollArea, QSizePolicy, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from . import state, theme
from .runner import PROJECT_ROOT, TaskRunner, open_folder
from .widgets import (
    Card, StatRow, StatusLine, TaskPanel, ask, button, error, info, lead, title, warn,
)


class Screen(QWidget):
    """모든 화면의 바탕. 제목 + 설명 + 내용."""

    heading = ""
    subheading = ""

    def __init__(self, app_window, parent=None):
        super().__init__(parent)
        self.win = app_window
        self.runner: TaskRunner | None = None

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        outer.addWidget(scroll)

        inner = QWidget()
        scroll.setWidget(inner)
        self.box = QVBoxLayout(inner)
        self.box.setContentsMargins(34, 28, 34, 28)
        self.box.setSpacing(20)

        if self.heading:
            self.box.addWidget(title(self.heading))
        if self.subheading:
            self.box.addWidget(lead(self.subheading))

        self.build()
        self.box.addStretch(1)

    def build(self) -> None:
        """화면마다 여기에 내용을 채웁니다."""

    def refresh(self) -> None:
        """화면이 다시 보일 때 값을 새로 읽습니다."""

    # ── 스크립트 실행 (공통) ────────────────────────────────
    def run_task(self, panel: TaskPanel, script: str, args: list[str] | None,
                 step: str, done_msg: str, buttons: list | None = None) -> None:
        if self.runner and self.runner.isRunning():
            warn(self, "이미 다른 작업이 돌고 있습니다.\n끝날 때까지 기다려 주세요.")
            return

        for b in (buttons or []):
            b.setEnabled(False)
        panel.start(step)

        self.runner = TaskRunner(script, args, self)
        self.runner.line.connect(panel.append)

        def finish(code: int) -> None:
            for b in (buttons or []):
                b.setEnabled(True)
            if code == 0:
                panel.done(done_msg)
            elif code == -1:
                panel.done("멈췄습니다.")
            else:
                panel.done("끝내지 못했습니다.")
                warn(self, "작업을 끝내지 못했습니다.\n\n"
                           "아래 작업 기록의 마지막 줄을 확인해 주세요.\n"
                           "도움말 화면에서 로그 폴더를 열어 보실 수도 있습니다.")
            self.refresh()
            self.win.refresh_all()

        def fail(msg: str) -> None:
            for b in (buttons or []):
                b.setEnabled(True)
            panel.done("시작하지 못했습니다.")
            error(self, "프로그램을 시작하지 못했습니다.", msg)

        self.runner.finished_ok.connect(finish)
        self.runner.failed.connect(fail)
        panel.cancel_btn.clicked.connect(self.runner.cancel)
        self.runner.start()


# ══════════════════════════════════════════════════════════════
class HomeScreen(Screen):
    heading = "홈"
    subheading = "지금 무엇을 해야 하는지 한눈에 보여 드립니다."

    def build(self) -> None:
        self.status_card = Card("지금 상태")
        self.line_naver = StatusLine("네이버 연결 확인 중…")
        self.line_style = StatusLine("글 양식 확인 중…")
        self.line_source = StatusLine("시세 확인 중…")
        for w in (self.line_naver, self.line_style, self.line_source):
            self.status_card.add(w)
        self.box.addWidget(self.status_card)

        num = Card("이번 주 진행")
        grid = QGridLayout()
        grid.setHorizontalSpacing(30)
        grid.setVerticalSpacing(8)
        self.stat_draft = StatRow("-", "원고")
        self.stat_review = StatRow("-", "검수 통과")
        self.stat_image = StatRow("-", "이미지")
        for i, w in enumerate((self.stat_draft, self.stat_review, self.stat_image)):
            grid.addWidget(w, 0, i)
        holder = QWidget()
        holder.setLayout(grid)
        num.add(holder)
        self.box.addWidget(num)

        today = Card("오늘 예약된 글")
        self.today_label = QLabel("확인 중…")
        self.today_label.setWordWrap(True)
        self.today_label.setStyleSheet(f"font-size: {theme.FONT_BASE}px;")
        today.add(self.today_label)
        self.box.addWidget(today)

        act = Card("바로 하기")
        row = QHBoxLayout()
        row.setSpacing(14)
        self.btn_write = button("새 글 작성하기", "Primary")
        self.btn_write.clicked.connect(lambda: self.win.go("글 작성"))
        self.btn_quote = button("오늘 시세 받기")
        self.btn_quote.clicked.connect(self._quotes)
        self.btn_retry = button("다시 확인하기")
        self.btn_retry.clicked.connect(self.win.refresh_all)
        for b in (self.btn_write, self.btn_quote, self.btn_retry):
            row.addWidget(b)
        holder2 = QWidget()
        holder2.setLayout(row)
        act.add(holder2)
        self.panel = TaskPanel()
        act.add(self.panel)
        self.box.addWidget(act)

    def _quotes(self) -> None:
        self.run_task(self.panel, "update_sources.py", None,
                      "시세를 받는 중입니다…", "시세를 받아 왔습니다.",
                      [self.btn_quote, self.btn_write])

    def refresh(self) -> None:
        h = state.health()
        self.line_naver.set(
            "네이버에 연결되어 있습니다." if h.naver_linked
            else "네이버에 아직 연결하지 않았습니다. (계정 연결 화면에서 연결하세요)",
            h.naver_linked)
        self.line_style.set(
            f"글 양식 분석 — 코인 {h.style_coin} · 주식 {h.style_stock}",
            h.style_coin != "없음" and h.style_stock != "없음")
        self.line_source.set(
            f"시세 마지막 확인 {h.sources_checked}"
            + (f" · 확인 필요 {h.sources_missing}개" if h.sources_missing else ""),
            h.sources_missing == 0 and h.sources_checked != "-")

        self.stat_draft.set(f"{h.drafted} / {h.total}", "원고를 쓴 글")
        self.stat_review.set(f"{h.reviewed} / {h.total}", "검수를 통과한 글")
        self.stat_image.set(f"{h.images_have} / {h.images_need}", "만든 이미지")

        rows = state.today_scheduled()
        if rows:
            self.today_label.setText("\n".join(
                f"·  {p.channel_name} — {p.title or p.slot or '(제목 없음)'}   [{p.status}]"
                for p in rows))
        else:
            self.today_label.setText("오늘 날짜로 잡힌 글이 없습니다.")


# ══════════════════════════════════════════════════════════════
class AccountScreen(Screen):
    heading = "계정 연결"
    subheading = ("네이버 로그인은 브라우저 창에서 직접 하십니다. "
                  "이 프로그램은 아이디와 비밀번호를 저장하지 않습니다.")

    def build(self) -> None:
        c = Card("연결 상태")
        self.line = StatusLine("확인 중…")
        c.add(self.line)
        self.detail = QLabel()
        self.detail.setWordWrap(True)
        self.detail.setStyleSheet(f"font-size: {theme.FONT_BASE}px; color: {theme.SUB};")
        c.add(self.detail)
        self.box.addWidget(c)

        safe = Card("어떻게 지키고 있나요")
        for t in ("아이디와 비밀번호를 프로그램에 넣지 않습니다.",
                  "로그인은 브라우저 창이 열리면 직접 하십니다.",
                  "로그인 상태만 private 폴더에 남고, 이 폴더는 깃허브에 올라가지 않습니다.",
                  "자동 로그인·캡차 우회 기능은 만들지 않았습니다."):
            safe.add(StatusLine(t, True))
        self.box.addWidget(safe)

        act = Card("연결 관리")
        row = QHBoxLayout()
        row.setSpacing(14)
        self.btn_open = button("로그인 폴더 열기")
        self.btn_open.clicked.connect(
            lambda: open_folder(PROJECT_ROOT / "private" / "browser-profile"))
        self.btn_reset = button("연결 끊기", "Danger")
        self.btn_reset.clicked.connect(self._disconnect)
        row.addWidget(self.btn_open)
        row.addWidget(self.btn_reset)
        row.addStretch(1)
        holder = QWidget()
        holder.setLayout(row)
        act.add(holder)
        self.box.addWidget(act)

    def _disconnect(self) -> None:
        prof = PROJECT_ROOT / "private" / "browser-profile"
        if not (prof.exists() and any(prof.iterdir())):
            info(self, "연결된 상태가 없습니다.")
            return
        if not ask(self, "네이버 연결을 끊습니다.\n\n"
                         "다음에 예약 등록을 하실 때 브라우저에서 다시 로그인하셔야 합니다.\n"
                         "글과 이미지는 지워지지 않습니다.", "네, 끊습니다"):
            return
        import shutil
        try:
            shutil.rmtree(prof)
            prof.mkdir(parents=True, exist_ok=True)
            info(self, "연결을 끊었습니다.")
        except OSError as exc:
            error(self, "연결을 끊지 못했습니다.\n\n브라우저가 열려 있으면 닫고 다시 해 보세요.", str(exc))
        self.refresh()

    def refresh(self) -> None:
        h = state.health()
        if h.naver_linked:
            self.line.set("네이버에 연결되어 있습니다.", True)
            self.detail.setText("예약 등록을 하실 때 다시 로그인하지 않아도 됩니다.\n"
                                "오래 두면 네이버 쪽에서 로그인이 풀릴 수 있습니다. "
                                "그때는 브라우저 창에서 한 번 더 로그인하시면 됩니다.")
        else:
            self.line.set("아직 연결하지 않았습니다.", False)
            self.detail.setText("예약·발행 화면에서 '예약 등록'을 처음 실행하시면 "
                                "브라우저 창이 열립니다. 그 창에서 직접 로그인하시면 연결됩니다.")


# ══════════════════════════════════════════════════════════════
class WriteScreen(Screen):
    heading = "글 작성"
    subheading = "다음 주 글을 만들고 검수합니다."

    def build(self) -> None:
        gen = Card("1단계 — 원고 만들기")
        gen.add(lead("다음 주에 올릴 글의 지시서와 원고를 만듭니다. 몇 분 걸릴 수 있습니다."))
        row = QHBoxLayout()
        row.setSpacing(14)
        self.btn_gen = button("다음 주 원고 만들기", "Primary")
        self.btn_gen.clicked.connect(self._generate)
        self.btn_review = button("전체 검수하기")
        self.btn_review.clicked.connect(self._review)
        row.addWidget(self.btn_gen)
        row.addWidget(self.btn_review)
        row.addStretch(1)
        hw = QWidget()
        hw.setLayout(row)
        gen.add(hw)
        self.panel = TaskPanel()
        gen.add(self.panel)
        self.box.addWidget(gen)

        lst = Card("이번 주 글")
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["채널", "날짜", "주제", "상태", "이미지"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setMinimumHeight(320)
        hh = self.table.horizontalHeader()
        hh.setSectionResizeMode(2, QHeaderView.Stretch)
        for i in (0, 1, 3, 4):
            hh.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        lst.add(self.table)

        row2 = QHBoxLayout()
        row2.setSpacing(14)
        self.btn_open = button("고른 글의 폴더 열기")
        self.btn_open.clicked.connect(self._open_selected)
        row2.addWidget(self.btn_open)
        row2.addStretch(1)
        hw2 = QWidget()
        hw2.setLayout(row2)
        lst.add(hw2)
        self.box.addWidget(lst)

    def _generate(self) -> None:
        if not ask(self, "다음 주 원고를 만듭니다.\n\n"
                         "이미 만들어 둔 글이 있으면 덮어쓰지 않고 건너뜁니다.\n"
                         "몇 분 걸릴 수 있습니다."):
            return
        self.run_task(self.panel, "generate_week.py", None,
                      "원고를 만드는 중입니다…", "원고를 만들었습니다.",
                      [self.btn_gen, self.btn_review])

    def _review(self) -> None:
        self.run_task(self.panel, "review.py", None,
                      "검수하는 중입니다…", "검수를 마쳤습니다.",
                      [self.btn_gen, self.btn_review])

    def _open_selected(self) -> None:
        r = self.table.currentRow()
        if r < 0:
            info(self, "먼저 위 목록에서 글을 하나 고르세요.")
            return
        open_folder(self._rows[r].folder)

    def refresh(self) -> None:
        self._rows = state.posts()
        self.table.setRowCount(len(self._rows))
        for i, p in enumerate(self._rows):
            cells = [p.channel_name, p.date, p.title or p.slot or "-", p.status,
                     "-" if p.images_need == 0 else f"{p.images_have}/{p.images_need}"]
            for j, v in enumerate(cells):
                it = QTableWidgetItem(v)
                if j == 3 and p.status == "지시서만":
                    it.setForeground(Qt.darkYellow)
                self.table.setItem(i, j, it)
        self.table.resizeRowsToContents()


# ══════════════════════════════════════════════════════════════
class ImageScreen(Screen):
    heading = "이미지 관리"
    subheading = "글마다 필요한 그림이 다 있는지 보여 드립니다."

    def build(self) -> None:
        c = Card("이미지 현황")
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["채널", "날짜", "이미지", "아직 없는 그림"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setMinimumHeight(340)
        hh = self.table.horizontalHeader()
        hh.setSectionResizeMode(3, QHeaderView.Stretch)
        for i in (0, 1, 2):
            hh.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        c.add(self.table)

        row = QHBoxLayout()
        row.setSpacing(14)
        self.btn_prompt = button("만드는 방법 열기", "Primary",
                                 "챗GPT에 붙여넣을 프롬프트가 들어 있는 파일을 엽니다")
        self.btn_prompt.clicked.connect(lambda: self._open("image_prompts.md"))
        self.btn_imgs = button("그림 넣을 폴더 열기")
        self.btn_imgs.clicked.connect(lambda: self._open("images"))
        self.btn_guide = button("챗GPT 사용법 보기")
        self.btn_guide.clicked.connect(self._guide)
        for b in (self.btn_prompt, self.btn_imgs, self.btn_guide):
            row.addWidget(b)
        row.addStretch(1)
        hw = QWidget()
        hw.setLayout(row)
        c.add(hw)
        self.box.addWidget(c)

    def _selected(self):
        r = self.table.currentRow()
        if r < 0:
            info(self, "먼저 위 목록에서 글을 하나 고르세요.")
            return None
        return self._rows[r]

    def _open(self, what: str) -> None:
        p = self._selected()
        if not p:
            return
        target = p.folder / what
        if what == "images":
            open_folder(target)
            return
        if not target.exists():
            warn(self, "이 글에는 아직 이미지 안내 파일이 없습니다.\n"
                       "먼저 '글 작성' 화면에서 원고를 만들어 주세요.")
            return
        import os
        os.startfile(str(target))  # noqa: S606

    def _guide(self) -> None:
        g = PROJECT_ROOT / "이미지_챗GPT_만드는법.md"
        if g.exists():
            import os
            os.startfile(str(g))  # noqa: S606
        else:
            warn(self, "사용법 문서를 찾지 못했습니다.")

    def refresh(self) -> None:
        self._rows = [p for p in state.posts() if p.images_need > 0]
        self.table.setRowCount(len(self._rows))
        for i, p in enumerate(self._rows):
            # 이미지 목록은 원고(post.md) 앞머리에 있습니다.
            fm = state.front_matter(p.folder / "post.md")
            missing = [
                str(im.get("file", ""))
                for im in (fm.get("images") or [])
                if isinstance(im, dict) and str(im.get("file", ""))
                and not (p.folder / "images" / str(im.get("file"))).exists()
            ]
            cells = [p.channel_name, p.date, f"{p.images_have}/{p.images_need}",
                     "다 있습니다" if not missing else ", ".join(missing)]
            for j, v in enumerate(cells):
                it = QTableWidgetItem(v)
                if j == 3 and missing:
                    it.setForeground(Qt.darkYellow)
                self.table.setItem(i, j, it)
        self.table.resizeRowsToContents()


# ══════════════════════════════════════════════════════════════
class PublishScreen(Screen):
    heading = "예약·발행"
    subheading = "검수를 통과한 글을 네이버에 예약 등록할 수 있게 준비합니다."

    def build(self) -> None:
        warn_card = Card("먼저 알아 두실 것")
        warn_card.add(StatusLine(
            "이 프로그램은 여러분이 누르지 않으면 네이버에 아무것도 올리지 않습니다.", True))
        warn_card.add(StatusLine(
            "처음에는 반드시 비공개로 한 건만 시험해 보세요.", None))
        warn_card.add(StatusLine(
            "브라우저 창이 열리면 로그인은 직접 하십니다.", None))
        self.box.addWidget(warn_card)

        p1 = Card("1단계 — 발행 준비")
        p1.add(lead("본문과 이미지를 네이버에 붙여넣기 좋은 형태로 모아 둡니다. "
                    "네이버에 접속하지 않습니다."))
        r1 = QHBoxLayout()
        r1.setSpacing(14)
        self.btn_prepare = button("발행 준비하기", "Primary")
        self.btn_prepare.clicked.connect(self._prepare)
        r1.addWidget(self.btn_prepare)
        r1.addStretch(1)
        h1 = QWidget()
        h1.setLayout(r1)
        p1.add(h1)
        self.box.addWidget(p1)

        p2 = Card("2단계 — 예약 등록 (브라우저가 열립니다)")
        self.state_line = StatusLine("확인 중…")
        p2.add(self.state_line)
        r2 = QHBoxLayout()
        r2.setSpacing(14)
        self.btn_schedule = button("예약 등록하기")
        self.btn_schedule.clicked.connect(self._schedule)
        r2.addWidget(self.btn_schedule)
        r2.addStretch(1)
        h2 = QWidget()
        h2.setLayout(r2)
        p2.add(h2)
        self.panel = TaskPanel()
        p2.add(self.panel)
        self.box.addWidget(p2)

    def _prepare(self) -> None:
        self.run_task(self.panel, "prepare_publish.py", None,
                      "발행 준비 중입니다…", "발행 준비를 마쳤습니다.",
                      [self.btn_prepare, self.btn_schedule])

    def _schedule(self) -> None:
        h = state.health()
        if not h.browser_enabled:
            warn(self, "브라우저 예약 등록이 꺼져 있습니다.\n\n"
                       "지금은 '발행 준비하기'로 만든 내용을 네이버에 직접 붙여넣는 방식입니다.\n"
                       "자동 등록을 쓰시려면 설정 화면에서 켜 주세요.")
            return
        if not ask(self, "네이버에 예약 등록을 시작합니다.\n\n"
                         "· 브라우저 창이 열립니다. 로그인은 직접 하셔야 합니다.\n"
                         "· 처음에는 비공개로 한 건만 등록됩니다.\n"
                         "· 화면이 예상과 다르면 즉시 멈춥니다.\n\n"
                         "계속하시겠습니까?", "네, 시작합니다"):
            return
        self.run_task(self.panel, "schedule_week.py", None,
                      "예약 등록 중입니다… 브라우저 창을 확인해 주세요.",
                      "예약 등록을 마쳤습니다.",
                      [self.btn_prepare, self.btn_schedule])

    def refresh(self) -> None:
        h = state.health()
        if h.browser_enabled:
            self.state_line.set("브라우저 예약 등록이 켜져 있습니다.", True)
        else:
            self.state_line.set(
                "브라우저 예약 등록이 꺼져 있습니다. (지금은 직접 붙여넣는 방식입니다)", None)


# ══════════════════════════════════════════════════════════════
class HistoryScreen(Screen):
    heading = "발행 내역"
    subheading = "지금까지 만든 글과 발행 결과를 봅니다."

    def build(self) -> None:
        c = Card("주차 고르기")
        r = QHBoxLayout()
        r.setSpacing(14)
        self.week = QComboBox()
        self.week.setMinimumWidth(240)
        self.week.currentTextChanged.connect(lambda _: self._fill())
        self.btn_check = button("발행 결과 확인하기", "Primary")
        self.btn_check.clicked.connect(self._check)
        self.btn_folder = button("결과 폴더 열기")
        self.btn_folder.clicked.connect(lambda: open_folder(PROJECT_ROOT / "output"))
        r.addWidget(self.week)
        r.addWidget(self.btn_check)
        r.addWidget(self.btn_folder)
        r.addStretch(1)
        hw = QWidget()
        hw.setLayout(r)
        c.add(hw)
        self.panel = TaskPanel()
        c.add(self.panel)
        self.box.addWidget(c)

        lst = Card("글 목록")
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["채널", "날짜", "주제", "상태"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setMinimumHeight(340)
        hh = self.table.horizontalHeader()
        hh.setSectionResizeMode(2, QHeaderView.Stretch)
        for i in (0, 1, 3):
            hh.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        lst.add(self.table)
        self.box.addWidget(lst)

    def _check(self) -> None:
        self.run_task(self.panel, "publish_status.py", None,
                      "발행 결과를 확인하는 중입니다…", "확인을 마쳤습니다.",
                      [self.btn_check])

    def _fill(self) -> None:
        rows = state.posts(self.week.currentText() or None)
        self.table.setRowCount(len(rows))
        for i, p in enumerate(rows):
            for j, v in enumerate([p.channel_name, p.date, p.title or p.slot or "-", p.status]):
                self.table.setItem(i, j, QTableWidgetItem(v))
        self.table.resizeRowsToContents()

    def refresh(self) -> None:
        out = PROJECT_ROOT / "output"
        weeks = sorted((p.name for p in out.iterdir()
                        if p.is_dir() and p.name.startswith("20")), reverse=True) if out.exists() else []
        cur = self.week.currentText()
        self.week.blockSignals(True)
        self.week.clear()
        self.week.addItems(weeks)
        if cur in weeks:
            self.week.setCurrentText(cur)
        self.week.blockSignals(False)
        self._fill()


# ══════════════════════════════════════════════════════════════
class SettingsScreen(Screen):
    heading = "설정"
    subheading = "자주 바꾸는 것만 모았습니다. 나머지는 설정 파일에서 고치실 수 있습니다."

    def build(self) -> None:
        c = Card("설정 파일")
        c.add(lead("발행 시각, 검수 기준, 브라우저 등록 켜고 끄기를 여기서 고칩니다.\n"
                   "파일이 열리면 고친 뒤 저장하시고, 이 프로그램을 다시 켜 주세요."))
        r = QHBoxLayout()
        r.setSpacing(14)
        self.btn_open = button("설정 파일 열기", "Primary")
        self.btn_open.clicked.connect(self._open_settings)
        self.btn_folder = button("설정 폴더 열기")
        self.btn_folder.clicked.connect(lambda: open_folder(PROJECT_ROOT / "config"))
        r.addWidget(self.btn_open)
        r.addWidget(self.btn_folder)
        r.addStretch(1)
        hw = QWidget()
        hw.setLayout(r)
        c.add(hw)
        self.box.addWidget(c)

        cur = Card("지금 설정")
        self.line_time = StatusLine("확인 중…")
        self.line_browser = StatusLine("확인 중…")
        self.line_machine = StatusLine("확인 중…")
        for w in (self.line_time, self.line_browser, self.line_machine):
            cur.add(w)
        self.box.addWidget(cur)

        sty = Card("글 양식")
        self.line_style = StatusLine("확인 중…")
        sty.add(self.line_style)
        r2 = QHBoxLayout()
        r2.setSpacing(14)
        self.btn_fetch = button("내 블로그 글 가져오기")
        self.btn_fetch.clicked.connect(self._fetch)
        r2.addWidget(self.btn_fetch)
        r2.addStretch(1)
        hw2 = QWidget()
        hw2.setLayout(r2)
        sty.add(hw2)
        self.panel = TaskPanel()
        sty.add(self.panel)
        self.box.addWidget(sty)

    def _open_settings(self) -> None:
        p = PROJECT_ROOT / "config" / "settings.yaml"
        if not p.exists():
            warn(self, "설정 파일이 아직 없습니다.\n프로그램을 한 번 실행하면 만들어집니다.")
            return
        import os
        os.startfile(str(p))  # noqa: S606

    def _fetch(self) -> None:
        self.run_task(self.panel, "fetch_samples.py", None,
                      "블로그 글을 가져오는 중입니다…", "가져왔습니다.",
                      [self.btn_fetch])

    def refresh(self) -> None:
        import yaml
        s = {}
        p = PROJECT_ROOT / "config" / "settings.yaml"
        if p.exists():
            try:
                s = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
            except Exception:  # noqa: BLE001
                s = {}
        times = s.get("publish_times") or {}
        self.line_time.set(
            f"예약 발행 시각 — 코인 {times.get('coin', '-')} · 주식 {times.get('stock', '-')}", None)
        on = bool((s.get("browser") or {}).get("enabled"))
        self.line_browser.set(
            "브라우저 예약 등록: " + ("켜짐" if on else "꺼짐 (직접 붙여넣기)"), None)
        self.line_machine.set(f"이 PC 이름: {s.get('machine_name', '-')}", None)
        h = state.health()
        self.line_style.set(f"코인 {h.style_coin} · 주식 {h.style_stock}", None)


# ══════════════════════════════════════════════════════════════
class HelpScreen(Screen):
    heading = "도움말"
    subheading = "설명서와 기록을 여기서 여실 수 있습니다."

    def build(self) -> None:
        d = Card("설명서")
        for label, path in state.docs():
            b = button(label)
            b.clicked.connect(lambda _=False, p=path: self._open(p))
            d.add(b)
        if not state.docs():
            d.add(lead("설명서 파일을 찾지 못했습니다."))
        self.box.addWidget(d)

        t = Card("문제가 생겼을 때")
        t.add(lead("아래 폴더의 가장 최근 기록 파일을 열어 보시면 무엇이 잘못됐는지 적혀 있습니다."))
        r = QHBoxLayout()
        r.setSpacing(14)
        b1 = button("기록(로그) 폴더 열기", "Primary")
        b1.clicked.connect(lambda: open_folder(PROJECT_ROOT / "logs"))
        b2 = button("프로그램 폴더 열기")
        b2.clicked.connect(lambda: open_folder(PROJECT_ROOT))
        r.addWidget(b1)
        r.addWidget(b2)
        r.addStretch(1)
        hw = QWidget()
        hw.setLayout(r)
        t.add(hw)
        self.box.addWidget(t)

        v = Card("프로그램 정보")
        self.info_label = QLabel()
        self.info_label.setWordWrap(True)
        self.info_label.setStyleSheet(f"font-size: {theme.FONT_BASE}px;")
        v.add(self.info_label)
        self.box.addWidget(v)

    def _open(self, path: Path) -> None:
        import os
        if path.exists():
            os.startfile(str(path))  # noqa: S606
        else:
            warn(self, f"파일을 찾지 못했습니다.\n\n{path}")

    def refresh(self) -> None:
        from . import __version__
        self.info_label.setText(
            f"네이버 블로그 도우미  {__version__}\n\n"
            f"설치 위치: {PROJECT_ROOT}\n"
            f"설정 파일: config\\settings.yaml\n"
            f"글 저장 위치: output\\<주차>\\<채널>\\<날짜>\\")
