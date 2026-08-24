# -*- coding: utf-8 -*-
"""
화면 7개 — 오늘 할 일 · 글 관리 · 발행 관리 · 발행 내역 (주요)
           네이버 연결 · 설정 · 도움말 (보조)

정확성 규칙
  · '예약 등록하기'는 browser_publish.py 를 부릅니다. (schedule_week.py 아님 —
    그건 다음 주 폴더를 만드는 기능이라 '주간 자동 생성' 칸으로 옮겼습니다)
  · 네이버에서 확인하지 않은 것을 '예약됨'·'발행됨'으로 표시하지 않습니다.
  · 실제 확인이 필요한 단계는 사람이 확인했다고 기록해야 넘어갑니다.
"""
from __future__ import annotations

import datetime as _dt
import os
import re
from pathlib import Path

from PySide6.QtCore import Qt, QTime
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QComboBox, QDialog, QDialogButtonBox,
    QGridLayout, QHBoxLayout, QHeaderView, QInputDialog, QLabel, QLineEdit,
    QPlainTextEdit, QScrollArea, QSpinBox, QSplitter, QStackedWidget,
    QTableWidget, QTableWidgetItem, QTabWidget, QTextBrowser, QTimeEdit,
    QVBoxLayout, QWidget,
)

from . import state, theme
from .runner import PROJECT_ROOT, TaskRunner, open_folder
from .widgets import (
    Card, Collapsible, StatRow, StatusLine, SummaryRow, TaskPanel,
    ask, button, error, info, lead, title, warn,
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
        self.box.setContentsMargins(34, 24, 34, 24)
        self.box.setSpacing(18)

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
                 step: str, done_msg: str, buttons: list | None = None,
                 extra_env: dict | None = None, on_done=None) -> None:
        if self.runner and self.runner.isRunning():
            warn(self, "이미 다른 작업이 돌고 있습니다.\n끝날 때까지 기다려 주세요.")
            return

        for b in (buttons or []):
            b.setEnabled(False)
        panel.start(step)

        self.runner = TaskRunner(script, args, self, extra_env=extra_env)
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
            if on_done:
                on_done(code)

        def fail(msg: str) -> None:
            for b in (buttons or []):
                b.setEnabled(True)
            panel.done("시작하지 못했습니다.")
            error(self, "프로그램을 시작하지 못했습니다.", msg)

        self.runner.finished_ok.connect(finish)
        self.runner.failed.connect(fail)
        panel.cancel_btn.clicked.connect(self.runner.cancel)
        self.runner.start()


def _hrow(widgets: list, stretch_end: bool = True) -> QWidget:
    row = QHBoxLayout()
    row.setSpacing(14)
    for w in widgets:
        row.addWidget(w)
    if stretch_end:
        row.addStretch(1)
    holder = QWidget()
    holder.setLayout(row)
    return holder


# ══════════════════════════════════════════════════════════════
class TodayScreen(Screen):
    heading = "오늘 할 일"
    subheading = "지금 무엇을 하면 되는지 한눈에 보여 드립니다."

    def build(self) -> None:
        self.status_card = Card("지금 상태")
        self.line_naver = StatusLine("네이버 연결 확인 중…")
        self.line_style = StatusLine("글 양식 확인 중…")
        self.line_source = StatusLine("시세 확인 중…")
        for w in (self.line_naver, self.line_style, self.line_source):
            self.status_card.add(w)
        self.box.addWidget(self.status_card)

        today = Card("오늘")
        self.line_direct = StatusLine("")
        self.line_reserved = StatusLine("")
        self.line_check = StatusLine("")
        self.line_problem = StatusLine("")
        for w in (self.line_direct, self.line_reserved, self.line_check, self.line_problem):
            today.add(w)
        self.box.addWidget(today)

        nxt = Card("다음 작업")
        self.next_label = QLabel("확인 중…")
        self.next_label.setWordWrap(True)
        self.next_label.setStyleSheet(f"font-size: {theme.FONT_BASE + 1}px;")
        nxt.add(self.next_label)
        self.btn_next = button("다음 작업 계속하기", "Primary")
        self.btn_next.clicked.connect(self._go_next)
        self.btn_refresh = button("다시 확인하기")
        self.btn_refresh.clicked.connect(self.win.refresh_all)
        nxt.add(_hrow([self.btn_next, self.btn_refresh]))
        self.box.addWidget(nxt)
        self._next_target = "글 관리"

    def _go_next(self) -> None:
        self.win.go(self._next_target)

    def refresh(self) -> None:
        h = state.health()
        self.line_naver.set(
            "네이버에 연결되어 있습니다." if h.naver_linked
            else "네이버에 아직 연결하지 않았습니다. (아래 '네이버 연결'에서 연결하세요)",
            h.naver_linked)
        self.line_style.set(
            f"글 양식 분석 — 코인 {h.style_coin} · 주식 {h.style_stock}",
            h.style_coin != "없음" and h.style_stock != "없음")
        self.line_source.set(
            f"시세 마지막 확인 {h.sources_checked}"
            + (f" · 확인 필요 {h.sources_missing}개" if h.sources_missing else ""),
            h.sources_missing == 0 and h.sources_checked != "-")

        rows = state.posts()
        direct = state.today_to_publish(rows)
        reserved = state.today_scheduled(rows)
        check = state.need_check(rows)
        probs = state.with_problems(rows)

        def names(ps):
            return " · ".join(f"{p.channel_name} {p.publish_time}" for p in ps)

        self.line_direct.set(
            f"오늘 직접 올릴 글 {len(direct)}편" + (f" — {names(direct)}" if direct else ""),
            None if not direct else True)
        self.line_reserved.set(
            f"오늘 예약 확인된 글 {len(reserved)}편"
            + (f" — {names(reserved)}" if reserved else "")
            + ("" if reserved else "  (네이버에서 확인된 예약만 셉니다)"),
            True if reserved else None)
        self.line_check.set(
            f"네이버 확인이 필요한 글 {len(check)}편",
            None if not check else False)
        self.line_problem.set(
            f"이미지·검수 문제가 있는 글 {len(probs)}편",
            True if not probs else False)

        text, target = state.next_action(rows)
        self.next_label.setText(text)
        self._next_target = target


# ══════════════════════════════════════════════════════════════
#  글 관리 — 목록 + 상세(원고·이미지·미리보기·검수)
# ══════════════════════════════════════════════════════════════
_HASHTAG_LINE = re.compile(r"(?m)^#\S+(?:\s+#\S+)*\s*$")


def _split_hashtags(body: str) -> tuple[str, str]:
    """본문에서 해시태그 줄을 떼어 (해시태그 줄, 나머지 본문) 으로 돌려줍니다."""
    matches = list(_HASHTAG_LINE.finditer(body))
    if not matches:
        return "", body
    m = matches[-1]
    rest = body[:m.start()] + "⟦해시태그⟧" + body[m.end():]
    return m.group(0).strip(), rest


def _join_hashtags(tags: str, body_with_marker: str) -> str:
    tags = tags.strip()
    if "⟦해시태그⟧" in body_with_marker:
        return body_with_marker.replace("⟦해시태그⟧", tags, 1)
    if tags:
        return body_with_marker.rstrip("\n") + "\n\n" + tags + "\n"
    return body_with_marker


class PostsScreen(Screen):
    heading = "글 관리"
    subheading = "글을 고르면 오른쪽에서 원고·이미지·검수를 한 번에 봅니다."

    def build(self) -> None:
        split = QSplitter(Qt.Horizontal)
        split.setChildrenCollapsible(False)

        # ── 왼쪽: 글 목록 ───────────────────────────────────
        left = QWidget()
        lv = QVBoxLayout(left)
        lv.setContentsMargins(0, 0, 0, 0)
        lv.setSpacing(10)
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["채널", "날짜", "제목", "상태", "이미지"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setWordWrap(False)      # 칸이 좁아도 글자를 세로로 쌓지 않습니다
        self.table.setMinimumWidth(380)
        hh = self.table.horizontalHeader()
        hh.setSectionResizeMode(2, QHeaderView.Stretch)
        for i in (0, 1, 3, 4):
            hh.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        self.table.itemSelectionChanged.connect(self._on_select)
        lv.addWidget(self.table, 1)
        self.btn_open = button("이 글의 폴더 열기")
        self.btn_open.clicked.connect(self._open_selected)
        lv.addWidget(self.btn_open)
        split.addWidget(left)

        # ── 오른쪽: 상세 탭 ─────────────────────────────────
        self.tabs = QTabWidget()
        self.tabs.setMinimumWidth(430)
        self._build_tab_edit()
        self._build_tab_images()
        self._build_tab_preview()
        self._build_tab_review()
        self.tabs.currentChanged.connect(lambda _i: self._load_detail())
        split.addWidget(self.tabs)
        split.setStretchFactor(0, 2)
        split.setStretchFactor(1, 3)
        split.setMinimumHeight(560)
        self.box.addWidget(split, 1)

        # ── 아래: 주간 자동 생성 (보조 기능) ────────────────
        auto = Card("주간 자동 생성 (보조 기능)")
        auto.add(lead("다음 주 월~토 12편의 폴더·지시서·원고를 미리 만들어 두는 기능입니다.\n"
                      "네이버 예약과는 관계가 없습니다. 예약은 '발행 관리'에서 합니다."))
        self.btn_slots = button("다음 주 자리 만들기")
        self.btn_slots.clicked.connect(self._make_slots)
        self.btn_gen = button("다음 주 원고 만들기")
        self.btn_gen.clicked.connect(self._generate)
        self.btn_quote = button("오늘 시세 받기")
        self.btn_quote.clicked.connect(self._quotes)
        auto.add(_hrow([self.btn_slots, self.btn_gen, self.btn_quote]))
        self.auto_panel = TaskPanel()
        auto.add(Collapsible(self.auto_panel, "작업 기록 보기"))
        self.box.addWidget(auto)

        self._rows: list[state.PostState] = []
        self._cur: state.PostState | None = None
        self._dirty = False
        self._loading = False

    # ── 상세 탭 만들기 ──────────────────────────────────────
    def _build_tab_edit(self) -> None:
        w = QWidget()
        v = QVBoxLayout(w)
        v.setContentsMargins(16, 16, 16, 16)
        v.setSpacing(10)

        v.addWidget(QLabel("제목"))
        self.ed_title = QLineEdit()
        self.ed_title.textEdited.connect(self._mark_dirty)
        v.addWidget(self.ed_title)

        v.addWidget(QLabel("본문"))
        self.ed_body = QPlainTextEdit()
        self.ed_body.setMinimumHeight(220)
        self.ed_body.textChanged.connect(self._mark_dirty)
        v.addWidget(self.ed_body, 1)

        v.addWidget(QLabel("해시태그 (띄어쓰기로 구분)"))
        self.ed_tags = QLineEdit()
        self.ed_tags.textEdited.connect(self._mark_dirty)
        v.addWidget(self.ed_tags)

        self.lbl_count = QLabel("")
        self.lbl_saved = QLabel("")
        self.lbl_saved.setStyleSheet(f"color: {theme.SUB};")
        self.btn_save = button("저장하기", "Primary")
        self.btn_save.clicked.connect(self._save_edit)
        v.addWidget(_hrow([self.btn_save, self.lbl_count, self.lbl_saved]))
        self.ed_body.textChanged.connect(self._update_count)
        self.tabs.addTab(w, "원고")

    def _build_tab_images(self) -> None:
        w = QWidget()
        v = QVBoxLayout(w)
        v.setContentsMargins(16, 16, 16, 16)
        v.setSpacing(10)

        self.img_table = QTableWidget(0, 4)
        self.img_table.setHorizontalHeaderLabels(["미리보기", "파일", "상태", "설명(대체 텍스트)"])
        self.img_table.verticalHeader().setVisible(False)
        self.img_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.img_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.img_table.setSelectionMode(QAbstractItemView.SingleSelection)
        ih = self.img_table.horizontalHeader()
        ih.setSectionResizeMode(3, QHeaderView.Stretch)
        for i in (0, 1, 2):
            ih.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        v.addWidget(self.img_table, 1)

        self.btn_up = button("위로")
        self.btn_up.clicked.connect(lambda: self._move_image(-1))
        self.btn_down = button("아래로")
        self.btn_down.clicked.connect(lambda: self._move_image(1))
        self.btn_swap = button("그림 바꾸기…")
        self.btn_swap.clicked.connect(self._replace_image)
        self.btn_imgdir = button("그림 폴더 열기")
        self.btn_imgdir.clicked.connect(self._open_images)
        v.addWidget(_hrow([self.btn_up, self.btn_down, self.btn_swap, self.btn_imgdir]))

        self.btn_info = button("정리 그림 만들기")
        self.btn_info.clicked.connect(self._infographic)
        self.btn_guide = button("이미지 만드는 법 보기")
        self.btn_guide.clicked.connect(self._guide)
        v.addWidget(_hrow([self.btn_info, self.btn_guide]))
        self.img_panel = TaskPanel()
        v.addWidget(Collapsible(self.img_panel, "작업 기록 보기"))
        self.tabs.addTab(w, "이미지")

    def _build_tab_preview(self) -> None:
        w = QWidget()
        v = QVBoxLayout(w)
        v.setContentsMargins(16, 16, 16, 16)
        self.preview = QTextBrowser()
        self.preview.setOpenExternalLinks(False)
        v.addWidget(self.preview, 1)
        self.tabs.addTab(w, "미리보기")

    def _build_tab_review(self) -> None:
        w = QWidget()
        v = QVBoxLayout(w)
        v.setContentsMargins(16, 16, 16, 16)
        v.setSpacing(12)
        self.rev_summary = SummaryRow()
        v.addWidget(self.rev_summary)
        self.rev_line = StatusLine("")
        v.addWidget(self.rev_line)
        self.btn_rev_one = button("이 글 검수하기", "Primary")
        self.btn_rev_one.clicked.connect(self._review_one)
        self.btn_rev_all = button("전체 검수하기")
        self.btn_rev_all.clicked.connect(self._review_all)
        self.btn_approve = button("이 글 승인하기")
        self.btn_approve.clicked.connect(self._approve)
        v.addWidget(_hrow([self.btn_rev_one, self.btn_rev_all, self.btn_approve]))
        self.rev_panel = TaskPanel()
        self.rev_collapse = Collapsible(self.rev_panel, "검수 기록 보기")
        v.addWidget(self.rev_collapse)
        v.addStretch(1)
        self.tabs.addTab(w, "검수")

    # ── 목록 ────────────────────────────────────────────────
    def refresh(self) -> None:
        sel_folder = self._cur.folder if self._cur else None
        self._rows = state.posts()
        self._loading = True
        self.table.setRowCount(len(self._rows))
        keep = -1
        for i, p in enumerate(self._rows):
            cells = [p.channel_name, p.date, p.title or p.slot or "-", p.status,
                     "-" if p.images_need == 0 else f"{p.images_have}/{p.images_need}"]
            for j, val in enumerate(cells):
                it = QTableWidgetItem(val)
                if j == 3 and p.problem:
                    it.setForeground(Qt.darkYellow)
                self.table.setItem(i, j, it)
            if sel_folder and p.folder == sel_folder:
                keep = i
        self.table.resizeRowsToContents()
        self._loading = False
        if keep >= 0:
            self.table.selectRow(keep)
        elif self._rows and self.table.currentRow() < 0:
            self.table.selectRow(0)
        self._update_review_summary()

    def _update_review_summary(self) -> None:
        drafted = [p for p in self._rows if p.has_draft]
        ok = sum(1 for p in drafted if p.review_passed)
        fail = sum(1 for p in drafted if p.raw_status == "failed")
        self.rev_summary.set(ok, len(drafted) - ok - fail, fail)

    def _on_select(self) -> None:
        if self._loading:
            return
        if self._dirty and self._cur:
            if not ask(self, "저장하지 않은 고침이 있습니다.\n\n"
                             "저장하지 않고 다른 글로 넘어가시겠습니까?",
                       "저장하지 않고 넘어가기"):
                # 원래 글로 되돌립니다.
                self._loading = True
                for i, p in enumerate(self._rows):
                    if p.folder == self._cur.folder:
                        self.table.selectRow(i)
                        break
                self._loading = False
                return
        r = self.table.currentRow()
        self._cur = self._rows[r] if 0 <= r < len(self._rows) else None
        self._load_detail()

    def _load_detail(self) -> None:
        p = self._cur
        self._loading = True
        try:
            if not p or not p.has_draft:
                self.ed_title.setText(p.title if p else "")
                self.ed_body.setPlainText("" if not p else "(아직 원고가 없습니다)")
                self.ed_tags.setText("")
                self.preview.setMarkdown("아직 원고가 없습니다.")
                self.img_table.setRowCount(0)
                self._dirty = False
                self._load_review_line()
                return
            fm = state.front_matter(p.folder / "post.md")
            _fm_text, body = state.split_post(p.folder / "post.md")
            tags, body_marked = _split_hashtags(body)
            self._body_marked = body_marked
            self.ed_title.setText(str(fm.get("title") or p.title))
            self.ed_body.setPlainText(body_marked.replace("⟦해시태그⟧", "").rstrip("\n"))
            self.ed_tags.setText(tags)
            self.lbl_saved.setText("")
            self._dirty = False

            # 미리보기 — [이미지:xx.png] 를 그림으로 바꿔서 보여 줍니다.
            md = re.sub(r"\[이미지:([^\]]+)\]", r"![](images/\1)", body)
            self.preview.setSearchPaths([str(p.folder)])
            self.preview.setMarkdown(f"# {fm.get('title') or p.title}\n\n{md}")

            self._load_images(p, fm)
            self._load_review_line()
            self._update_count()
        finally:
            self._loading = False

    def _load_review_line(self) -> None:
        p = self._cur
        if not p:
            self.rev_line.set("글을 먼저 골라 주세요.", None)
            return
        if p.raw_status == "failed":
            self.rev_line.set(f"실패로 기록됨 — {p.fail_note or '사유 기록 없음'}", False)
        elif p.review_passed:
            self.rev_line.set(f"이 글: 검수 통과  (현재 상태: {p.status})", True)
        else:
            self.rev_line.set(f"이 글: 검수 미통과  (현재 상태: {p.status})", False)

    # ── 원고 편집 ───────────────────────────────────────────
    def _mark_dirty(self) -> None:
        if not self._loading:
            self._dirty = True
            self.lbl_saved.setText("저장 안 됨")

    def _update_count(self) -> None:
        n = len(self.ed_body.toPlainText().replace(" ", "").replace("\n", ""))
        self.lbl_count.setText(f"본문 {n}자 (공백 제외)")

    def _save_edit(self) -> None:
        p = self._cur
        if not p or not p.has_draft:
            warn(self, "저장할 원고가 없습니다.")
            return
        body = self.ed_body.toPlainText()
        if "⟦해시태그⟧" in getattr(self, "_body_marked", ""):
            # 원래 위치에 해시태그를 되돌려 넣습니다.
            marked = self._body_marked
            head, _sep, _tail = marked.partition("⟦해시태그⟧")
            # 사용자가 본문을 통째로 고쳤으므로, 해시태그는 원래 위치 대신
            # 편집한 본문 뒤에 붙입니다. (위치까지 흉내 내면 오히려 어긋납니다)
            body = body.rstrip("\n") + "\n"
            tags = self.ed_tags.text().strip()
            if tags:
                body += "\n" + tags + "\n"
            # 해시태그 줄 뒤에 있던 꼬리(유의 문구 등)를 잃지 않게 붙입니다.
            tail = _tail.lstrip("\n")
            if tail.strip():
                body += "\n" + tail
        else:
            body = _join_hashtags(self.ed_tags.text(), body + "\n")

        ok, err = state.save_post(p.folder, self.ed_title.text().strip(), body)
        if not ok:
            error(self, "저장하지 못했습니다.\n\n" + err)
            return
        self._dirty = False
        now = state.now_kst().strftime("%H:%M:%S")
        self.lbl_saved.setText(f"저장됨 {now}")
        info(self, "저장했습니다.\n\n고친 글은 다시 검수해 주세요. (검수 탭)")
        self.refresh()

    # ── 이미지 ──────────────────────────────────────────────
    def _load_images(self, p: state.PostState, fm: dict) -> None:
        imgs = [i for i in (fm.get("images") or []) if isinstance(i, dict)]
        self._img_files = [str(i.get("file", "")) for i in imgs]
        self.img_table.setRowCount(len(imgs))
        self.img_table.setIconSize
        for r, item in enumerate(imgs):
            f = str(item.get("file", ""))
            path = p.folder / "images" / f
            cell = QLabel()
            cell.setAlignment(Qt.AlignCenter)
            if path.exists():
                pix = QPixmap(str(path))
                if not pix.isNull():
                    cell.setPixmap(pix.scaledToHeight(84, Qt.SmoothTransformation))
                st = "대표" if r == 0 else "있음"
            else:
                cell.setText("없음")
                cell.setStyleSheet(f"color: {theme.WARN}; font-weight: bold;")
                st = "아직 없음"
            self.img_table.setCellWidget(r, 0, cell)
            self.img_table.setItem(r, 1, QTableWidgetItem(f))
            it = QTableWidgetItem(st)
            if st == "아직 없음":
                it.setForeground(Qt.darkYellow)
            self.img_table.setItem(r, 2, it)
            self.img_table.setItem(r, 3, QTableWidgetItem(str(item.get("alt", ""))))
        self.img_table.resizeRowsToContents()

    def _move_image(self, delta: int) -> None:
        p = self._cur
        r = self.img_table.currentRow()
        if not p or r < 0:
            info(self, "먼저 옮길 그림 줄을 골라 주세요.")
            return
        t = r + delta
        if not 0 <= t < len(self._img_files):
            return
        order = list(self._img_files)
        order[r], order[t] = order[t], order[r]
        ok, err = state.save_image_order(p.folder, order)
        if not ok:
            error(self, "순서를 저장하지 못했습니다.\n\n" + err)
            return
        self._load_detail()
        self.img_table.selectRow(t)

    def _replace_image(self) -> None:
        p = self._cur
        r = self.img_table.currentRow()
        if not p or r < 0:
            info(self, "먼저 바꿀 그림 줄을 골라 주세요.")
            return
        from PySide6.QtWidgets import QFileDialog
        src, _f = QFileDialog.getOpenFileName(
            self, "새 그림 고르기", str(Path.home() / "Desktop"),
            "그림 파일 (*.png *.jpg *.jpeg)")
        if not src:
            return
        target = p.folder / "images" / self._img_files[r]
        if target.exists() and not ask(
                self, f"이미 있는 그림을 새 그림으로 바꿉니다.\n\n{target.name}\n\n"
                      "이전 그림은 .bak 으로 남겨 둡니다.", "네, 바꿉니다"):
            return
        import shutil
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                shutil.copy2(target, target.with_suffix(target.suffix + ".bak"))
            shutil.copy2(src, target)
        except OSError as exc:
            error(self, "그림을 바꾸지 못했습니다.", str(exc))
            return
        self._load_detail()

    def _open_images(self) -> None:
        if self._cur:
            open_folder(self._cur.folder / "images")

    def _infographic(self) -> None:
        p = self._cur
        if not p:
            info(self, "먼저 글을 골라 주세요.")
            return
        self.run_task(self.img_panel, "infographic.py", ["--post", str(p.folder)],
                      "그림을 그리는 중입니다…", "그림을 만들었습니다.",
                      [self.btn_info])

    def _guide(self) -> None:
        g = PROJECT_ROOT / "이미지_챗GPT_만드는법.md"
        if g.exists():
            os.startfile(str(g))  # noqa: S606
        else:
            warn(self, "사용법 문서를 찾지 못했습니다.")

    # ── 검수·승인 ───────────────────────────────────────────
    def _review_one(self) -> None:
        p = self._cur
        if not p or not p.has_draft:
            info(self, "먼저 원고가 있는 글을 골라 주세요.")
            return
        self.rev_collapse.open()
        self.run_task(self.rev_panel, "review.py", ["--post", p.post_id],
                      "이 글을 검수하는 중입니다…", "검수를 마쳤습니다.",
                      [self.btn_rev_one, self.btn_rev_all])

    def _review_all(self) -> None:
        self.rev_collapse.open()
        self.run_task(self.rev_panel, "review.py", None,
                      "전체 글을 검수하는 중입니다…", "검수를 마쳤습니다.",
                      [self.btn_rev_one, self.btn_rev_all])

    def _approve(self) -> None:
        p = self._cur
        if not p:
            info(self, "먼저 글을 골라 주세요.")
            return
        if not p.review_passed:
            warn(self, "검수를 통과한 글만 승인할 수 있습니다.\n먼저 검수해 주세요.")
            return
        if not ask(self, f"이 글을 승인합니다.\n\n{p.channel_name} {p.date}\n"
                         f"{p.title or p.slot}\n\n"
                         "승인하면 발행 관리에서 예약·발행을 할 수 있게 됩니다.",
                   "네, 승인합니다"):
            return
        self.rev_collapse.open()
        self.run_task(self.rev_panel, "approve.py", ["--post", p.post_id, "--yes"],
                      "승인하는 중입니다…", "승인했습니다.",
                      [self.btn_approve], extra_env={"NBA_CONFIRMED": "1"})

    # ── 보조 기능 ───────────────────────────────────────────
    def _make_slots(self) -> None:
        if not ask(self, "다음 주 월~토 12편의 폴더와 지시서를 만듭니다.\n\n"
                         "네이버에는 아무것도 등록되지 않습니다."):
            return
        self.run_task(self.auto_panel, "schedule_week.py", None,
                      "다음 주 자리를 만드는 중입니다…", "다음 주 자리를 만들었습니다.",
                      [self.btn_slots, self.btn_gen])

    def _generate(self) -> None:
        if not ask(self, "다음 주 원고를 만듭니다.\n\n"
                         "이미 만들어 둔 글이 있으면 덮어쓰지 않고 건너뜁니다.\n"
                         "몇 분 걸릴 수 있습니다."):
            return
        self.run_task(self.auto_panel, "generate_week.py", None,
                      "원고를 만드는 중입니다…", "원고를 만들었습니다.",
                      [self.btn_slots, self.btn_gen])

    def _quotes(self) -> None:
        self.run_task(self.auto_panel, "update_sources.py", None,
                      "시세를 받는 중입니다…", "시세를 받아 왔습니다.",
                      [self.btn_quote])

    def _open_selected(self) -> None:
        if self._cur:
            open_folder(self._cur.folder)
        else:
            info(self, "먼저 목록에서 글을 하나 골라 주세요.")


# ══════════════════════════════════════════════════════════════
#  발행 관리 — 발행 대기 · 예약됨 · 확인 필요 · 실패
# ══════════════════════════════════════════════════════════════
class ReserveDialog(QDialog):
    """예약 발행 전 마지막 확인 — 검사에 걸리면 진행할 수 없습니다."""

    def __init__(self, post: state.PostState, all_posts, parent=None):
        super().__init__(parent)
        self.post = post
        self.all_posts = all_posts
        self.setWindowTitle("예약 발행")
        self.setMinimumWidth(560)
        v = QVBoxLayout(self)
        v.setSpacing(12)

        head = QLabel(f"{post.channel_name}\n{post.title or post.slot}")
        head.setWordWrap(True)
        head.setStyleSheet(f"font-size: {theme.FONT_BASE + 1}px; font-weight: bold;")
        v.addWidget(head)
        v.addWidget(QLabel(f"예약 날짜: {post.date} ({post.weekday})"))

        row = QHBoxLayout()
        row.addWidget(QLabel("예약 시각:"))
        self.time_edit = QTimeEdit()
        self.time_edit.setDisplayFormat("HH:mm")
        try:
            hh, mm = map(int, post.publish_time.split(":"))
            self.time_edit.setTime(QTime(hh, mm))
        except (ValueError, AttributeError):
            self.time_edit.setTime(QTime(8, 0))
        self.time_edit.timeChanged.connect(self._check)
        row.addWidget(self.time_edit)
        row.addStretch(1)
        holder = QWidget()
        holder.setLayout(row)
        v.addWidget(holder)

        self.problems = QLabel("")
        self.problems.setWordWrap(True)
        v.addWidget(self.problems)

        self.buttons = QDialogButtonBox()
        self.ok_btn = self.buttons.addButton("이대로 예약 진행", QDialogButtonBox.AcceptRole)
        self.buttons.addButton("취소", QDialogButtonBox.RejectRole)
        self.buttons.accepted.connect(self.accept)
        self.buttons.rejected.connect(self.reject)
        v.addWidget(self.buttons)
        self._check()

    def chosen_time(self) -> str:
        return self.time_edit.time().toString("HH:mm")

    def _check(self) -> None:
        when = _dt.datetime.strptime(
            f"{self.post.date} {self.chosen_time()}", "%Y-%m-%d %H:%M"
        ).replace(tzinfo=state.KST)
        probs = state.reserve_check(self.post, when, self.all_posts)
        if probs:
            self.problems.setText("아직 예약할 수 없습니다:\n" + "\n".join(f"· {p}" for p in probs))
            self.problems.setStyleSheet(f"color: {theme.DANGER}; font-size: {theme.FONT_BASE}px;")
            self.ok_btn.setEnabled(False)
        else:
            self.problems.setText("검사를 통과했습니다. 브라우저가 열리면 화면을 보면서 진행됩니다.")
            self.problems.setStyleSheet(f"color: {theme.OK}; font-size: {theme.FONT_BASE}px;")
            self.ok_btn.setEnabled(True)


class PublishManageScreen(Screen):
    heading = "발행 관리"
    subheading = "글 한 편을 골라 준비 → 비공개 시험 → 예약 → 확인 순서로 진행합니다."

    TABS = [
        ("발행 대기", state.WAITING),
        ("예약됨", state.RESERVED),
        ("확인 필요", state.NEED_CHECK),
        ("실패", ("failed",)),
    ]

    def build(self) -> None:
        self.state_line = StatusLine("확인 중…")
        c = Card("")
        c.add(self.state_line)
        self.box.addWidget(c)

        self.tabs = QTabWidget()
        self.tables: list[QTableWidget] = []
        for name, _keys in self.TABS:
            t = QTableWidget(0, 7)
            t.setHorizontalHeaderLabels(
                ["채널", "제목", "날짜", "시각", "상태", "검수", "이미지"])
            t.verticalHeader().setVisible(False)
            t.setEditTriggers(QAbstractItemView.NoEditTriggers)
            t.setSelectionBehavior(QAbstractItemView.SelectRows)
            t.setSelectionMode(QAbstractItemView.SingleSelection)
            t.setWordWrap(False)   # 칸이 좁아도 글자를 세로로 쌓지 않습니다
            t.setMinimumHeight(260)
            hh = t.horizontalHeader()
            hh.setSectionResizeMode(1, QHeaderView.Stretch)
            for i in (0, 2, 3, 4, 5, 6):
                hh.setSectionResizeMode(i, QHeaderView.ResizeToContents)
            self.tables.append(t)
            self.tabs.addTab(t, name)
        self.tabs.currentChanged.connect(self._tab_changed)
        self.box.addWidget(self.tabs)

        # 탭마다 다른 단추 줄
        self.btn_stack = QStackedWidget()

        # 0 — 발행 대기
        self.btn_prepare = button("발행 준비하기")
        self.btn_prepare.clicked.connect(self._prepare)
        self.btn_fill = button("비공개로 시험 저장")
        self.btn_fill.clicked.connect(self._fill)
        self.btn_reserve = button("예약 발행하기…", "Primary")
        self.btn_reserve.clicked.connect(self._reserve)
        self.btn_direct = button("지금 발행 (직접)…")
        self.btn_direct.clicked.connect(self._direct)
        # 최소 창 너비(1000px)에서도 다 보이도록 두 줄로 놓습니다.
        g0 = QGridLayout()
        g0.setHorizontalSpacing(14)
        g0.setVerticalSpacing(10)
        g0.addWidget(self.btn_prepare, 0, 0)
        g0.addWidget(self.btn_fill, 0, 1)
        g0.addWidget(self.btn_reserve, 1, 0)
        g0.addWidget(self.btn_direct, 1, 1)
        g0.setColumnStretch(2, 1)
        w0 = QWidget()
        w0.setLayout(g0)
        self.btn_stack.addWidget(w0)

        # 1 — 예약됨
        self.btn_pubdone = button("발행됐습니다 — 기록하기…", "Primary")
        self.btn_pubdone.clicked.connect(self._record_published)
        self.btn_resv_fail = button("실패로 기록…", "Danger")
        self.btn_resv_fail.clicked.connect(self._record_fail)
        self.btn_stack.addWidget(_hrow([self.btn_pubdone, self.btn_resv_fail]))

        # 2 — 확인 필요
        self.btn_verify = button("네이버 예약 목록에서 확인했습니다", "Primary")
        self.btn_verify.clicked.connect(self._record_verified)
        self.btn_pverify = button("발행된 글을 확인했습니다…")
        self.btn_pverify.clicked.connect(self._record_post_verified)
        self.btn_chk_fail = button("실패로 기록…", "Danger")
        self.btn_chk_fail.clicked.connect(self._record_fail)
        self.btn_stack.addWidget(_hrow([self.btn_verify, self.btn_pverify, self.btn_chk_fail]))

        # 3 — 실패
        self.btn_fail_why = button("원인 보기")
        self.btn_fail_why.clicked.connect(self._show_fail)
        self.btn_fail_dir = button("폴더 열기")
        self.btn_fail_dir.clicked.connect(self._open_dir)
        self.btn_stack.addWidget(_hrow([self.btn_fail_why, self.btn_fail_dir]))

        self.box.addWidget(self.btn_stack)
        self.panel = TaskPanel()
        self.box.addWidget(Collapsible(self.panel, "작업 기록 보기"))
        self._rows: list[state.PostState] = []
        self._by_tab: list[list[state.PostState]] = [[], [], [], []]

    # ── 목록 ────────────────────────────────────────────────
    def _tab_changed(self, idx: int) -> None:
        self.btn_stack.setCurrentIndex(idx)

    def refresh(self) -> None:
        h = state.health()
        if h.browser_enabled:
            self.state_line.set("브라우저 예약 등록: 켜짐 — 로그인은 브라우저 창에서 직접 하십니다.", True)
        else:
            self.state_line.set("브라우저 예약 등록: 꺼짐 — '발행 준비하기'로 만든 내용을 "
                                "직접 붙여넣는 방식입니다. (설정에서 켤 수 있습니다)", None)

        self._rows = state.posts()
        for ti, (_name, keys) in enumerate(self.TABS):
            rows = [p for p in self._rows if p.raw_status in keys]
            self._by_tab[ti] = rows
            t = self.tables[ti]
            t.setRowCount(len(rows))
            for i, p in enumerate(rows):
                cells = [p.channel_name, p.title or p.slot or "-", p.date,
                         p.publish_time or "-", p.status,
                         "통과" if p.review_passed else "미통과",
                         "-" if p.images_need == 0 else f"{p.images_have}/{p.images_need}"]
                for j, val in enumerate(cells):
                    it = QTableWidgetItem(val)
                    if j == 5 and not p.review_passed:
                        it.setForeground(Qt.darkYellow)
                    t.setItem(i, j, it)
            t.resizeRowsToContents()
            self.tabs.setTabText(ti, f"{self.TABS[ti][0]} ({len(rows)})")
            if rows and t.currentRow() < 0:
                t.selectRow(0)

    def _selected(self) -> state.PostState | None:
        ti = self.tabs.currentIndex()
        t = self.tables[ti]
        r = t.currentRow()
        if r < 0 or r >= len(self._by_tab[ti]):
            info(self, "먼저 목록에서 글을 하나 골라 주세요.")
            return None
        return self._by_tab[ti][r]

    # ── 발행 대기 동작 ──────────────────────────────────────
    def _prepare(self) -> None:
        p = self._selected()
        if not p:
            return
        self.run_task(self.panel, "prepare_publish.py", ["--post", p.post_id],
                      "발행 준비 중입니다…", "발행 준비를 마쳤습니다.",
                      [self.btn_prepare, self.btn_fill, self.btn_reserve])

    def _fill(self) -> None:
        p = self._selected()
        if not p:
            return
        if not state.health().browser_enabled:
            warn(self, "브라우저 예약 등록이 꺼져 있습니다.\n\n"
                       "설정 화면에서 '브라우저 예약 등록'을 켠 뒤 다시 해 주세요.")
            return
        if not (p.folder / "publish" / "blocks.yaml").exists():
            warn(self, "발행 준비가 아직 안 된 글입니다.\n\n"
                       "먼저 '발행 준비하기'를 눌러 주세요.")
            return
        if not ask(self, "브라우저를 열어 편집기에 글을 넣고 **비공개로만** 저장합니다.\n\n"
                         "· 로그인은 브라우저 창에서 직접 하십니다.\n"
                         "· 공개 발행은 하지 않습니다.\n"
                         "· 화면이 예상과 다르면 즉시 멈춥니다.\n\n"
                         "이 확인이 곧 '비공개 저장' 승인입니다.", "네, 비공개로 저장합니다"):
            return
        self.run_task(self.panel, state.RESERVE_SCRIPT,
                      ["--fill", "--post", p.post_id, "--channel", p.channel, "--confirm"],
                      "브라우저에서 편집기 입력 중입니다… 창을 확인해 주세요.",
                      "비공개 저장까지 마쳤습니다.",
                      [self.btn_prepare, self.btn_fill, self.btn_reserve],
                      extra_env={"NBA_CONFIRMED": "1"})

    def _reserve(self) -> None:
        p = self._selected()
        if not p:
            return
        if p.raw_status != "draft_saved":
            warn(self, "예약은 '비공개 저장됨' 상태의 글만 걸 수 있습니다.\n\n"
                       f"이 글은 지금 '{p.status}' 입니다.\n"
                       "먼저 '비공개로 시험 저장'을 해 주세요.")
            return
        dlg = ReserveDialog(p, self._rows, self)
        if dlg.exec() != QDialog.Accepted:
            return
        hhmm = dlg.chosen_time()
        if hhmm != p.publish_time:
            state.set_publish_time(p, hhmm)
        if not ask(self, f"네이버에 예약을 겁니다.\n\n"
                         f"{p.channel_name}\n{p.title or p.slot}\n"
                         f"{p.date} ({p.weekday}) {hhmm}\n\n"
                         "브라우저 화면을 보면서 진행되며,\n"
                         "이 확인이 곧 예약 저장 승인입니다.", "네, 예약을 겁니다"):
            return

        def after(code: int) -> None:
            if code == 0:
                info(self, "예약 요청을 마쳤습니다.\n\n"
                           "아직 '예약 확인됨'이 아닙니다.\n"
                           "네이버 예약 목록에서 제목과 시각을 확인한 뒤\n"
                           "'확인 필요' 탭에서 [네이버 예약 목록에서 확인했습니다]를 눌러 주세요.")
                self.tabs.setCurrentIndex(2)

        self.run_task(self.panel, state.RESERVE_SCRIPT,
                      ["--reserve", "--post", p.post_id, "--channel", p.channel, "--confirm"],
                      "브라우저에서 예약을 거는 중입니다… 창을 확인해 주세요.",
                      "예약 요청을 마쳤습니다. (네이버 확인 전)",
                      [self.btn_prepare, self.btn_fill, self.btn_reserve],
                      extra_env={"NBA_CONFIRMED": "1"}, on_done=after)

    def _direct(self) -> None:
        p = self._selected()
        if not p:
            return
        if not (p.folder / "publish" / "body.txt").exists():
            warn(self, "발행 준비가 아직 안 된 글입니다.\n\n먼저 '발행 준비하기'를 눌러 주세요.")
            return
        info(self, "지금 발행은 직접 붙여넣는 방식입니다.\n\n"
                   f"블로그: {p.channel_name}\n제목: {p.title or p.slot}\n"
                   f"이미지: {p.images_have}/{p.images_need}장\n\n"
                   "1. 지금 여는 폴더의 '붙여넣기 안내'를 따라 올려 주세요.\n"
                   "2. 다 올린 뒤 [발행됐습니다 — 기록하기]로 주소를 남겨 주세요.\n\n"
                   "이 프로그램이 대신 공개 발행하지는 않습니다.")
        open_folder(p.folder / "publish")

    # ── 확인·기록 동작 ──────────────────────────────────────
    def _record(self, p: state.PostState, status: str, url: str = "",
                force: bool = False, note: str = "") -> None:
        args = ["--set", status, "--post", p.post_id]
        if url:
            args += ["--url", url]
        if force:
            args += ["--force"]
        if note:
            args += ["--note", note]
        self.run_task(self.panel, "publish_status.py", args,
                      "기록하는 중입니다…", "기록했습니다.", [])

    def _record_verified(self) -> None:
        p = self._selected()
        if not p:
            return
        if p.raw_status != "reservation_requested":
            warn(self, "이 단추는 '예약 요청됨' 상태의 글에만 씁니다.")
            return
        if not ask(self, "네이버 예약 목록에서 이 글의 **제목과 예약 시각**을\n"
                         "직접 확인하셨습니까?\n\n"
                         f"{p.title or p.slot}\n{p.date} {p.publish_time}\n\n"
                         "확인했을 때만 '예약 확인됨'으로 기록됩니다.",
                   "네, 확인했습니다"):
            return
        self._record(p, "reservation_verified")

    def _record_published(self) -> None:
        p = self._selected()
        if not p:
            return
        url, okd = QInputDialog.getText(
            self, "발행 기록", "발행된 글 주소를 붙여넣어 주세요.\n"
            "(예: https://blog.naver.com/아이디/글번호)\n\n"
            "주소 없이 기록하려면 비워 두셔도 됩니다.")
        if not okd:
            return
        force = p.raw_status not in state.RESERVED
        note = "예약 없이 직접 발행 (화면에서 기록)" if force else ""
        if not ask(self, "네이버에 이 글이 **실제로 올라간 것**을 확인하셨습니까?\n\n"
                         f"{p.title or p.slot}", "네, 올라갔습니다"):
            return
        self._record(p, "published", url=url.strip(), force=force, note=note)

    def _record_post_verified(self) -> None:
        p = self._selected()
        if not p:
            return
        if p.raw_status != "published":
            warn(self, "이 단추는 '발행됨' 상태의 글에만 씁니다.")
            return
        url, okd = QInputDialog.getText(
            self, "발행 확인", "발행된 글 주소를 붙여넣어 주세요.",
            text=p.url)
        if not okd:
            return
        self._record(p, "post_publish_verified", url=url.strip())

    def _record_fail(self) -> None:
        p = self._selected()
        if not p:
            return
        note, okd = QInputDialog.getText(
            self, "실패 기록", "무엇이 잘못됐는지 짧게 적어 주세요.")
        if not okd:
            return
        args = ["--fail", "--post", p.post_id]
        if note.strip():
            args += ["--note", note.strip()]
        self.run_task(self.panel, "publish_status.py", args,
                      "기록하는 중입니다…", "실패로 기록했습니다.", [])

    def _show_fail(self) -> None:
        p = self._selected()
        if not p:
            return
        info(self, f"{p.channel_name} {p.date}\n{p.title or p.slot}\n\n"
                   f"실패 사유: {p.fail_note or '기록이 없습니다.'}\n\n"
                   "원인을 고친 뒤 '작업 기록'의 안내대로 상태를 되돌려 이어서 하시면 됩니다.")

    def _open_dir(self) -> None:
        p = self._selected()
        if p:
            open_folder(p.folder)


# ══════════════════════════════════════════════════════════════
class HistoryScreen(Screen):
    heading = "발행 내역"
    subheading = "네이버에 실제로 올라간 글의 결과를 봅니다."

    def build(self) -> None:
        c = Card("주차 고르기")
        self.week = QComboBox()
        self.week.setMinimumWidth(240)
        self.week.currentTextChanged.connect(lambda _t: self._fill())
        self.btn_url = button("글 주소 열기")
        self.btn_url.clicked.connect(self._open_url)
        self.btn_folder = button("결과 폴더 열기")
        self.btn_folder.clicked.connect(lambda: open_folder(PROJECT_ROOT / "output"))
        c.add(_hrow([self.week, self.btn_url, self.btn_folder]))
        self.box.addWidget(c)

        lst = Card("발행된 글")
        self.empty = lead("네이버에서 확인된 발행 글이 아직 없습니다.\n"
                          "예약·발행을 마치고 결과를 기록하면 여기에 나타납니다.")
        lst.add(self.empty)
        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(
            ["채널", "제목", "예약 시각", "발행 확인", "상태", "주소"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setWordWrap(False)
        self.table.setMinimumHeight(280)
        hh = self.table.horizontalHeader()
        hh.setSectionResizeMode(1, QHeaderView.Stretch)
        for i in (0, 2, 3, 4, 5):
            hh.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        lst.add(self.table)
        self.box.addWidget(lst)

        prog = Card("작업 진행 상태 (내부 기록)")
        prog.add(lead("네이버를 조회하는 것이 아니라, 이 컴퓨터에 기록된 진행 단계를 보여 줍니다."))
        self.btn_check = button("작업 진행 상태 보기")
        self.btn_check.clicked.connect(self._check)
        prog.add(_hrow([self.btn_check]))
        self.panel = TaskPanel()
        self.prog_collapse = Collapsible(self.panel, "진행 상태 기록 보기")
        prog.add(self.prog_collapse)
        self.box.addWidget(prog)
        self._rows: list[state.PostState] = []

    def _check(self) -> None:
        self.prog_collapse.open()
        args = ["--week", self.week.currentText()] if self.week.currentText() else None
        self.run_task(self.panel, "publish_status.py", args,
                      "진행 상태를 읽는 중입니다…", "다 읽었습니다.", [self.btn_check])

    def _fill(self) -> None:
        rows = state.posts(self.week.currentText() or None)
        # 발행 내역에는 실제 발행 단계에 든 글만 올립니다.
        self._rows = [p for p in rows
                      if p.raw_status in ("published", "post_publish_verified")]
        self.empty.setVisible(not self._rows)
        self.table.setVisible(bool(self._rows))
        self.table.setRowCount(len(self._rows))
        for i, p in enumerate(self._rows):
            verified = p.raw_status == "post_publish_verified"
            cells = [p.channel_name, p.title or p.slot or "-",
                     f"{p.date} {p.publish_time}".strip(),
                     "확인 완료" if verified else "확인 필요",
                     p.status, p.url or "-"]
            for j, val in enumerate(cells):
                it = QTableWidgetItem(val)
                if j == 3 and not verified:
                    it.setForeground(Qt.darkYellow)
                self.table.setItem(i, j, it)
        self.table.resizeRowsToContents()

    def _open_url(self) -> None:
        r = self.table.currentRow()
        if r < 0 or r >= len(self._rows):
            info(self, "먼저 목록에서 글을 골라 주세요.")
            return
        url = self._rows[r].url
        if not url:
            warn(self, "이 글에는 아직 기록된 주소가 없습니다.\n\n"
                       "발행 관리의 [발행된 글을 확인했습니다]로 주소를 기록해 주세요.")
            return
        os.startfile(url)  # noqa: S606 - 기본 브라우저로 열기만 합니다

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
class AccountScreen(Screen):
    heading = "네이버 연결"
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
        self.btn_open = button("로그인 폴더 열기")
        self.btn_open.clicked.connect(
            lambda: open_folder(PROJECT_ROOT / "private" / "browser-profile"))
        self.btn_reset = button("연결 끊기", "Danger")
        self.btn_reset.clicked.connect(self._disconnect)
        act.add(_hrow([self.btn_open, self.btn_reset]))
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
            self.detail.setText("발행 관리에서 '비공개로 시험 저장'을 처음 실행하시면 "
                                "브라우저 창이 열립니다. 그 창에서 직접 로그인하시면 연결됩니다.")


# ══════════════════════════════════════════════════════════════
class SettingsScreen(Screen):
    heading = "설정"
    subheading = "여기서 고치고 저장하면 바로 적용됩니다. 프로그램을 다시 켤 필요가 없습니다."

    def build(self) -> None:
        t = Card("발행 시각")
        g = QGridLayout()
        g.setHorizontalSpacing(20)
        g.setVerticalSpacing(10)
        g.addWidget(QLabel("코인 채널"), 0, 0)
        self.f_coin = QTimeEdit()
        self.f_coin.setDisplayFormat("HH:mm")
        g.addWidget(self.f_coin, 0, 1)
        g.addWidget(QLabel("주식 채널"), 1, 0)
        self.f_stock = QTimeEdit()
        self.f_stock.setDisplayFormat("HH:mm")
        g.addWidget(self.f_stock, 1, 1)
        self.f_holiday = QCheckBox("공휴일에도 발행합니다")
        g.addWidget(self.f_holiday, 2, 0, 1, 2)
        holder = QWidget()
        holder.setLayout(g)
        t.add(holder)
        self.box.addWidget(t)

        r = Card("예약 규칙")
        g2 = QGridLayout()
        g2.setHorizontalSpacing(20)
        g2.setVerticalSpacing(10)
        g2.addWidget(QLabel("같은 채널 글 사이 최소 간격(시간)"), 0, 0)
        self.f_gap = QSpinBox()
        self.f_gap.setRange(0, 48)
        g2.addWidget(self.f_gap, 0, 1)
        g2.addWidget(QLabel("예약은 지금부터 최소 몇 시간 뒤(시간)"), 1, 0)
        self.f_lead = QSpinBox()
        self.f_lead.setRange(0, 48)
        g2.addWidget(self.f_lead, 1, 1)
        holder2 = QWidget()
        holder2.setLayout(g2)
        r.add(holder2)
        self.box.addWidget(r)

        b = Card("브라우저 예약 등록")
        self.f_browser = QCheckBox("브라우저로 예약 등록을 합니다 (끄면 직접 붙여넣기)")
        b.add(self.f_browser)
        g3 = QGridLayout()
        g3.setHorizontalSpacing(20)
        g3.setVerticalSpacing(10)
        g3.addWidget(QLabel("네이버 계정"), 0, 0)
        self.f_account = QComboBox()
        self.f_account.addItem("두 블로그가 한 계정입니다", "same_account")
        self.f_account.addItem("블로그마다 계정이 다릅니다", "separate_accounts")
        g3.addWidget(self.f_account, 0, 1)
        g3.addWidget(QLabel("한 번에 등록할 최대 글 수"), 1, 0)
        self.f_max = QSpinBox()
        self.f_max.setRange(1, 3)
        g3.addWidget(self.f_max, 1, 1)
        holder3 = QWidget()
        holder3.setLayout(g3)
        b.add(holder3)
        self.box.addWidget(b)

        self.btn_save = button("저장하기", "Primary")
        self.btn_save.clicked.connect(self._save)
        self.lbl_saved = QLabel("")
        self.lbl_saved.setStyleSheet(f"color: {theme.SUB};")
        self.box.addWidget(_hrow([self.btn_save, self.lbl_saved]))

        # 고급 — 접어 둡니다
        adv_inner = QWidget()
        av = QVBoxLayout(adv_inner)
        av.setContentsMargins(0, 0, 0, 0)
        av.setSpacing(10)
        av.addWidget(lead("아래 기능은 평소에는 쓸 일이 없습니다."))
        b1 = button("설정 파일 직접 열기")
        b1.clicked.connect(self._open_settings)
        b2 = button("설정 폴더 열기")
        b2.clicked.connect(lambda: open_folder(PROJECT_ROOT / "config"))
        self.btn_fetch = button("내 블로그 글 다시 가져오기")
        self.btn_fetch.clicked.connect(self._fetch)
        av.addWidget(_hrow([b1, b2, self.btn_fetch]))
        self.panel = TaskPanel()
        av.addWidget(self.panel)
        self.box.addWidget(Collapsible(adv_inner, "고급 설정 보기"))

    def _save(self) -> None:
        vals = {
            "coin_time": self.f_coin.time().toString("HH:mm"),
            "stock_time": self.f_stock.time().toString("HH:mm"),
            "holiday": self.f_holiday.isChecked(),
            "gap_hours": self.f_gap.value(),
            "lead_hours": self.f_lead.value(),
            "browser_on": self.f_browser.isChecked(),
            "account_mode": self.f_account.currentData(),
            "max_posts": self.f_max.value(),
        }
        ok, err = state.save_settings(vals)
        if not ok:
            error(self, "저장하지 못했습니다.\n\n" + err)
            return
        now = state.now_kst().strftime("%H:%M:%S")
        self.lbl_saved.setText(f"저장됨 {now} — 바로 적용됐습니다.")
        self.win.refresh_all()

    def _open_settings(self) -> None:
        p = PROJECT_ROOT / "config" / "settings.yaml"
        if not p.exists():
            warn(self, "설정 파일이 아직 없습니다.\n프로그램을 한 번 실행하면 만들어집니다.")
            return
        os.startfile(str(p))  # noqa: S606

    def _fetch(self) -> None:
        self.run_task(self.panel, "fetch_samples.py", None,
                      "블로그 글을 가져오는 중입니다…", "가져왔습니다.",
                      [self.btn_fetch])

    def refresh(self) -> None:
        f = state.read_settings_form()
        try:
            hh, mm = map(int, f["coin_time"].split(":"))
            self.f_coin.setTime(QTime(hh, mm))
            hh, mm = map(int, f["stock_time"].split(":"))
            self.f_stock.setTime(QTime(hh, mm))
        except ValueError:
            pass
        self.f_holiday.setChecked(f["holiday"])
        self.f_gap.setValue(f["gap_hours"])
        self.f_lead.setValue(f["lead_hours"])
        self.f_browser.setChecked(f["browser_on"])
        idx = self.f_account.findData(f["account_mode"])
        if idx >= 0:
            self.f_account.setCurrentIndex(idx)
        self.f_max.setValue(f["max_posts"])


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
        b1 = button("기록(로그) 폴더 열기", "Primary")
        b1.clicked.connect(lambda: open_folder(PROJECT_ROOT / "logs"))
        b2 = button("프로그램 폴더 열기")
        b2.clicked.connect(lambda: open_folder(PROJECT_ROOT))
        t.add(_hrow([b1, b2]))
        self.box.addWidget(t)

        v = Card("프로그램 정보")
        self.info_label = QLabel()
        self.info_label.setWordWrap(True)
        self.info_label.setStyleSheet(f"font-size: {theme.FONT_BASE}px;")
        v.add(self.info_label)
        self.box.addWidget(v)

    def _open(self, path: Path) -> None:
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
