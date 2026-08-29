"""새 영상 만들기 — 지시서 §4 · §9.

    맛집 정보 입력 + 참고 URL + 음식 사진 + 대가성 체크
            ↓  [AI 구성 만들기]
    대본과 Scene Preview — 담당자가 수정
            ↓  [영상 제작]   ← 누르기 전에 예상 비용을 원화로
    진행상황 (6단계)
            ↓
    완료: [영상 재생] [폴더 열기] [Scene 다시 만들기]

Stage 4 에서 대본 생성을 붙였습니다.

- 열쇠가 있으면 [AI 구성 만들기] 가 **진짜 대본**을 만듭니다.
- 열쇠가 없으면 예시를 보여주고, 왜 진짜가 아닌지 화면에 적습니다.
- 담당자가 고친 대본도 **만들 때와 같은 규칙**으로 검사합니다.

영상·음성·자막·합성은 아직입니다 (Stage 6~9).
"""

from __future__ import annotations

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QCheckBox,
    QFormLayout,
    QGridLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QPushButton,
    QScrollArea,
    QStackedWidget,
    QTextEdit,
    QWidget,
)

from app.contracts.errors import ProviderError
from app.contracts.models import AdDisclosure, RenderMode, Script, StoreInfo
from app.core.script_rules import check_script
from app.ui import theme
from app.ui.widgets import (
    BusyButton,
    ErrorBox,
    NoticeBox,
    StepTrail,
    card,
    field_label,
    hbox,
    label,
    vbox,
)

PROGRESS_STEPS = [
    "대본 완료", "이미지 생성", "영상 생성", "음성 생성", "자막 생성", "최종 합성",
]

# Stage 2 에서 화면을 채우기 위한 예시입니다. 실제 생성 결과가 아닙니다.
SAMPLE_SCENES = [
    (1, 0, 3, RenderMode.KLING, "신림에 6천 원짜리 수상한 집이 있습니다.", "6천 원?"),
    (2, 3, 7, RenderMode.KENBURNS, "골목 안쪽 오래된 국수집입니다.", "신림동 골목"),
    (3, 7, 12, RenderMode.KENBURNS, "멸치로 낸 국물에 손칼국수를 씁니다.", "멸치 손칼국수"),
    (4, 12, 17, RenderMode.KLING, "한 입 먹어보니 국물이 깊습니다.", "국물이 깊다"),
    (5, 17, 23, RenderMode.KENBURNS, "6천 원이고 서울대입구역 5분입니다.", "6,000원 · 도보 5분"),
]

RENDER_LABEL = {
    RenderMode.KLING: ("오락이 · 영상 생성", theme.ACCENT, theme.ACCENT_SOFT),
    RenderMode.KENBURNS: ("실제 사진 · 움직임", theme.OK, theme.OK_SOFT),
    RenderMode.STILL: ("정지 화면", theme.INK_SOFT, theme.CARD_ALT),
}


def _scroll(inner: QWidget) -> QScrollArea:
    sa = QScrollArea()
    sa.setWidgetResizable(True)
    sa.setWidget(inner)
    return sa


class NewVideoScreen(QWidget):
    STEP_INPUT, STEP_SCRIPT, STEP_RUN, STEP_DONE = range(4)

    def __init__(self, script_provider: object | None = None,
                 max_kling_clips: int = 2) -> None:
        """``script_provider`` 를 주면 진짜 대본을 만듭니다.

        안 주면 예시를 보여주고 「예시입니다」 라고 화면에 적습니다.
        열쇠는 설정에서 넣습니다.
        """
        super().__init__()
        self.script_provider = script_provider
        self.max_kling_clips = max_kling_clips
        self.script: Script | None = None
        self.last_error = ""
        self.stack = QStackedWidget()
        lay = vbox(self, pad=0, gap=0)
        lay.addWidget(self.stack)

        self.stack.addWidget(self._build_input())
        self.stack.addWidget(self._build_script())
        self.stack.addWidget(self._build_run())
        self.stack.addWidget(self._build_done())

    # 시험과 화면 전환이 같은 문을 쓰게 합니다.
    def go(self, step: int) -> None:
        self.stack.setCurrentIndex(step)

    @property
    def step(self) -> int:
        return self.stack.currentIndex()

    # ── 1. 입력 ───────────────────────────────────────────────
    def _build_input(self) -> QWidget:
        page = QWidget()
        lay = vbox(page, pad=theme.PAD_L)

        lay.addWidget(label("새 영상 만들기", name="ScreenTitle"))
        lay.addWidget(label("맛집 정보를 넣어주세요. ● 는 꼭 채우셔야 합니다.",
                            name="ScreenSub"))

        body = QWidget()
        bl = vbox(body, pad=0)

        # 맛집 정보
        info = card()
        il = vbox(info)
        il.addWidget(label("맛집 정보", name="SectionHead"))
        form = QFormLayout()
        form.setSpacing(12)
        form.setLabelAlignment(Qt.AlignLeft)
        self.fields: dict[str, QLineEdit] = {}
        for key, text, need, ph in [
            ("store_name", "매장명", True, "예: 할머니 손칼국수"),
            ("area", "지역", True, "예: 신림 / 봉천 / 서울대입구"),
            ("address", "주소", True, "예: 관악구 신림로 00길 0"),
            ("menu", "대표메뉴", True, "예: 손칼국수"),
            ("price", "가격", True, "예: 6,000원"),
            ("features", "특징", True, "예: 멸치 국물 · 면을 직접 뽑음"),
            ("reason", "추천 이유", True, "예: 이 가격에 이 양이 드뭅니다"),
            ("memo", "메모", False, "안 쓰셔도 됩니다"),
        ]:
            line = QLineEdit()
            line.setPlaceholderText(ph)
            self.fields[key] = line
            form.addRow(field_label(text, required=need), line)
        il.addLayout(form)
        bl.addWidget(info)

        # 참고 URL — §4 고정 안내
        urls = card()
        ul = vbox(urls)
        ul.addWidget(label("참고 주소", name="SectionHead"))
        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("주소를 붙여넣고 [추가] 를 누르세요")
        row = hbox()
        row.addWidget(self.url_input, 1)
        add = QPushButton("추가")
        add.setObjectName("Secondary")
        add.clicked.connect(self._add_url)
        row.addWidget(add)
        ul.addLayout(row)
        self.url_list = QListWidget()
        self.url_list.setMaximumHeight(96)
        ul.addWidget(self.url_list)
        ul.addWidget(NoticeBox(
            "링크는 저장만 됩니다. 프로그램이 대신 읽지 않습니다.\n"
            "페이지를 직접 열어보시고 필요한 내용을 위 칸에 적어주세요.",
            tone="info",
        ))
        bl.addWidget(urls)

        # 음식 사진
        photos = card()
        pl = vbox(photos)
        pl.addWidget(label("음식 사진", name="SectionHead"))
        pl.addWidget(label(
            "실제로 찍은 사진을 넣으면 그 장면은 영상 생성 비용이 들지 않습니다.",
            name="Hint"))
        prow = hbox()
        pick = QPushButton("사진 고르기")
        pick.setObjectName("Secondary")
        prow.addWidget(pick)
        self.photo_count = label("고른 사진 없음", name="Hint", wrap=False)
        prow.addWidget(self.photo_count)
        prow.addStretch(1)
        pl.addLayout(prow)
        bl.addWidget(photos)

        # 대가성 — §5
        promo = card()
        ql = vbox(promo)
        ql.addWidget(label("광고 표시", name="SectionHead"))
        self.paid_check = QCheckBox("이 매장에서 대가나 협찬을 받았습니다")
        self.paid_check.toggled.connect(self._on_paid_toggled)
        ql.addWidget(self.paid_check)
        self.paid_notice = NoticeBox(
            "체크하시면 영상 시작·중간·끝에 「유료광고 포함」이 자동으로 들어갑니다.\n"
            "게시글 설명 맨 앞에도 붙습니다. 법으로 정해진 것이라 끌 수 없습니다.",
            tone="warn", title="자동으로 들어갑니다",
        )
        self.paid_notice.setVisible(False)
        ql.addWidget(self.paid_notice)
        bl.addWidget(promo)

        bl.addStretch(1)
        lay.addWidget(_scroll(body), 1)

        # 아래 오류 자리 + 버튼
        self.input_error = label("", wrap=True)
        self.input_error.setStyleSheet(
            f"background: {theme.BAD_SOFT}; color: {theme.BAD}; border-radius: 6px;"
            f" padding: 12px 14px; font-size: {theme.FS_BODY}px; font-weight: 600;")
        self.input_error.setVisible(False)
        lay.addWidget(self.input_error)

        foot = hbox()
        foot.addStretch(1)
        self.make_script_button = BusyButton(
            "AI 구성 만들기", busy_text="대본을 만들고 있습니다…")
        self.make_script_button.clicked.connect(self._make_script)
        foot.addWidget(self.make_script_button)
        lay.addLayout(foot)
        return page

    def _add_url(self) -> None:
        text = self.url_input.text().strip()
        if text:
            self.url_list.addItem(text)
            self.url_input.clear()

    def _on_paid_toggled(self, on: bool) -> None:
        self.paid_notice.setVisible(on)

    def store_info(self) -> StoreInfo:
        """담당자가 넣은 것을 모읍니다. 참고 주소는 **저장만** 합니다 (§0-4)."""
        from app.contracts.models import ReferenceUrl

        f = {k: w.text().strip() for k, w in self.fields.items()}
        urls = tuple(
            ReferenceUrl(url=self.url_list.item(i).text())
            for i in range(self.url_list.count()))
        return StoreInfo(
            store_name=f["store_name"], area=f["area"], address=f["address"],
            menu=f["menu"], price=f["price"], features=f["features"],
            reason=f["reason"], memo=f["memo"],
            reference_urls=urls,
            disclosure=AdDisclosure(is_paid=self.paid_check.isChecked()),
        )

    def missing_required(self) -> list[str]:
        """● 표시된 칸 중 비어 있는 것."""
        이름 = {"store_name": "매장명", "area": "지역", "address": "주소",
                "menu": "대표메뉴", "price": "가격", "features": "특징",
                "reason": "추천 이유"}
        return [이름[k] for k in 이름 if not self.fields[k].text().strip()]

    def _make_script(self) -> None:
        빈칸 = self.missing_required()
        if 빈칸:
            self.input_error.setText(
                "다음 칸을 채워주세요 — " + " · ".join(빈칸))
            self.input_error.setVisible(True)
            self.make_script_button.finish()
            return
        self.input_error.setVisible(False)
        QTimer.singleShot(0, self._run_script_generation)

    def _run_script_generation(self) -> None:
        """대본을 만듭니다. 실패하면 한국어로 알리고 입력 화면에 남습니다 (§9)."""
        if self.script_provider is None:
            self.script = None
            self.refresh_script_view()
            self.go(self.STEP_SCRIPT)
            self.make_script_button.finish()
            return
        try:
            self.script = self.script_provider.generate(self.store_info())
            self.last_error = ""
        except ProviderError as e:
            self.last_error = e.user_message
            self.input_error.setText(e.user_message)
            self.input_error.setVisible(True)
            self.make_script_button.finish()
            return
        self.refresh_script_view()
        self.go(self.STEP_SCRIPT)
        self.make_script_button.finish()

    # ── 2. 대본 확인 ──────────────────────────────────────────
    def _build_script(self) -> QWidget:
        page = QWidget()
        lay = vbox(page, pad=theme.PAD_L)
        lay.addWidget(label("대본 확인", name="ScreenTitle"))
        lay.addWidget(label("고치실 곳이 있으면 바로 고치세요. 고친 대로 영상이 만들어집니다.",
                            name="ScreenSub"))

        self.sample_notice = NoticeBox(
            "아래 내용은 화면을 보여드리기 위한 예시입니다. 실제로 AI 가 만든 대본이 아닙니다.\n"
            "설정에서 대본 만들기 열쇠를 넣으시면 진짜 대본이 나옵니다.",
            tone="info", title="아직 예시입니다")
        lay.addWidget(self.sample_notice)

        self.rule_notice = label("", wrap=True)
        self.rule_notice.setStyleSheet(
            f"background: {theme.WARN_SOFT}; color: {theme.WARN}; border-radius: 6px;"
            f" padding: 12px 14px; font-size: {theme.FS_SMALL}px;")
        self.rule_notice.setVisible(False)
        lay.addWidget(self.rule_notice)

        self.scene_holder = QWidget()
        self.scene_layout = vbox(self.scene_holder, pad=0)
        lay.addWidget(_scroll(self.scene_holder), 1)

        self.summary = QGridLayout()
        self.summary.setHorizontalSpacing(28)
        self.summary.setVerticalSpacing(6)
        cost = card()
        cl = vbox(cost)
        cl.addWidget(label("만들기 전에 확인해 주세요", name="SectionHead", wrap=False))
        cl.addLayout(self.summary)
        lay.addWidget(cost)

        foot = hbox()
        back = QPushButton("← 입력으로 돌아가기")
        back.setObjectName("Secondary")
        back.clicked.connect(lambda: self.go(self.STEP_INPUT))
        foot.addWidget(back)
        foot.addStretch(1)
        self.produce_button = BusyButton("영상 제작", busy_text="영상을 만들고 있습니다…")
        self.produce_button.clicked.connect(self._produce)
        foot.addWidget(self.produce_button)
        lay.addLayout(foot)

        self.scene_editors: list[tuple[int, QTextEdit, QLineEdit]] = []
        self.refresh_script_view()
        return page

    def scenes_as_dicts(self) -> list[dict]:
        """지금 화면에 있는 대본. **담당자가 고친 내용이 반영됩니다.**"""
        if self.script is not None:
            base = [
                {"idx": s.idx, "start_sec": s.start_sec, "end_sec": s.end_sec,
                 "render_mode": s.render_mode.value, "narration": s.narration,
                 "screen_text": s.screen_text}
                for s in self.script.scenes
            ]
        else:
            base = [
                {"idx": i, "start_sec": a, "end_sec": b, "render_mode": m.value,
                 "narration": n, "screen_text": t}
                for i, a, b, m, n, t in SAMPLE_SCENES
            ]
        for (idx, nar, txt) in self.scene_editors:
            for d in base:
                if d["idx"] == idx:
                    d["narration"] = nar.toPlainText()
                    d["screen_text"] = txt.text()
        return base

    def check_edits(self) -> list:
        """담당자가 고친 대본을 **만들 때와 같은 규칙**으로 검사합니다."""
        scenes = self.scenes_as_dicts()
        paid = self.paid_check.isChecked()
        caption = self.script.caption if self.script else ""
        hashtags = list(self.script.hashtags) if self.script else ["#a"] * 5
        return check_script(
            {"scenes": scenes, "caption": caption, "hashtags": hashtags,
             "hook": "", "full_text": "", "title": ""},
            is_paid_promotion=paid, max_kling_clips=self.max_kling_clips)

    def refresh_script_view(self) -> None:
        """대본이 바뀌면 화면을 다시 그립니다."""
        while self.scene_layout.count():
            item = self.scene_layout.takeAt(0)
            if w := item.widget():
                w.setParent(None)
        self.scene_editors = []

        진짜 = self.script is not None
        self.sample_notice.setVisible(not 진짜)

        if 진짜:
            rows = [(s.idx, s.start_sec, s.end_sec, s.render_mode,
                     s.narration, s.screen_text) for s in self.script.scenes]
        else:
            rows = list(SAMPLE_SCENES)

        for idx, start, end, mode, narration, screen_text in rows:
            self.scene_layout.addWidget(
                self._scene_card(idx, start, end, mode, narration, screen_text))
        self.scene_layout.addStretch(1)

        kling = sum(1 for r in rows if r[3] is RenderMode.KLING)
        total = max((r[2] for r in rows), default=0)
        while self.summary.count():
            item = self.summary.takeAt(0)
            if w := item.widget():
                w.setParent(None)
        for col, (k, v) in enumerate([
            ("총 길이", f"{total:g}초  (30초까지 됩니다)"),
            ("영상 생성 장면", f"{kling}개  (한 편에 {self.max_kling_clips}개까지)"),
            ("실제 사진 장면", f"{len(rows) - kling}개  (비용 없음)"),
            ("예상 비용", self._cost_text()),
        ]):
            k_lb = label(k, name="Hint", wrap=False)
            v_lb = label(v, wrap=False)
            v_lb.setStyleSheet(f"font-size: {theme.FS_BODY}px; font-weight: 700;")
            self.summary.addWidget(k_lb, 0, col)
            self.summary.addWidget(v_lb, 1, col)

        self.update_rule_notice()

    def _cost_text(self) -> str:
        if self.script_provider is None:
            return "열쇠를 넣으면 계산합니다"
        try:
            est = self.script_provider.estimate(self.store_info(), 5)
        except Exception:
            return "요금표를 아직 못 읽었습니다"
        if not est.is_complete:
            return "일부 요금 미확인"
        return f"{est.krw:,}원"

    def update_rule_notice(self) -> None:
        """규칙을 어긴 게 있으면 화면 위에 보여줍니다."""
        problems = self.check_edits()
        if not problems:
            self.rule_notice.setVisible(False)
            self.produce_button.setEnabled(True)
            return
        줄 = "\n".join(f"· {p.where} — {p.message}"
                        + (f"  ({p.fix})" if p.fix else "")
                        for p in problems[:6])
        더 = f"\n… 그 밖에 {len(problems) - 6}가지" if len(problems) > 6 else ""
        self.rule_notice.setText("고치셔야 만들 수 있습니다\n" + 줄 + 더)
        self.rule_notice.setVisible(True)
        self.produce_button.setEnabled(False)

    def _scene_card(self, idx: int, start: float, end: float, mode: RenderMode,
                    narration: str, screen_text: str) -> QWidget:
        c = card()
        cl = vbox(c, pad=16, gap=10)

        head = hbox()
        no = label(f"장면 {idx}", wrap=False)
        no.setStyleSheet(f"font-size: {theme.FS_HEAD}px; font-weight: 700;")
        head.addWidget(no)
        secs = label(f"{start:g}초 ~ {end:g}초", name="Hint", wrap=False)
        head.addWidget(secs)
        head.addStretch(1)
        text, fg, bg = RENDER_LABEL[mode]
        tag = QLabel(text)
        tag.setStyleSheet(
            f"background: {bg}; color: {fg}; border-radius: 11px;"
            f" padding: 4px 12px; font-size: {theme.FS_SMALL}px; font-weight: 700;"
        )
        head.addWidget(tag)
        cl.addLayout(head)

        cl.addWidget(label("읽어줄 말", name="Hint"))
        nar = QTextEdit(narration)
        nar.setFixedHeight(58)
        nar.textChanged.connect(self.update_rule_notice)
        cl.addWidget(nar)

        cl.addWidget(label("화면에 뜰 자막  (한 줄 16자까지)", name="Hint"))
        st = QLineEdit(screen_text)
        st.textChanged.connect(self.update_rule_notice)
        cl.addWidget(st)

        # 담당자가 고친 것을 읽어올 수 있게 등록합니다.
        self.scene_editors.append((idx, nar, st))
        return c

    def _produce(self) -> None:
        # Stage 6~9 에서 진짜 제작이 들어옵니다.
        QTimer.singleShot(0, lambda: (self.go(self.STEP_RUN),
                                      self.produce_button.finish()))

    # ── 3. 진행 중 ────────────────────────────────────────────
    def _build_run(self) -> QWidget:
        page = QWidget()
        lay = vbox(page, pad=theme.PAD_L)
        lay.addWidget(label("영상을 만들고 있습니다", name="ScreenTitle"))
        lay.addWidget(label("창을 닫으셔도 됩니다. 다시 켜면 이어서 진행합니다.",
                            name="ScreenSub"))

        c = card()
        cl = vbox(c, pad=24, gap=20)
        self.trail = StepTrail(PROGRESS_STEPS)
        cl.addWidget(self.trail)
        self.run_note = label("잠시만 기다려 주세요.")
        self.run_note.setStyleSheet(f"font-size: {theme.FS_BODY}px;")
        cl.addWidget(self.run_note)
        lay.addWidget(c)
        lay.addStretch(1)

        foot = hbox()
        foot.addStretch(1)
        skip = QPushButton("완료 화면 보기  (Stage 2 확인용)")
        skip.setObjectName("Secondary")
        skip.clicked.connect(lambda: self.go(self.STEP_DONE))
        foot.addWidget(skip)
        lay.addLayout(foot)
        return page

    def set_progress(self, index: int, note: str = "") -> None:
        self.trail.set_current(index)
        if note:
            self.run_note.setText(note)

    # ── 4. 완료 ───────────────────────────────────────────────
    def _build_done(self) -> QWidget:
        page = QWidget()
        lay = vbox(page, pad=theme.PAD_L)
        lay.addWidget(label("다 됐습니다", name="ScreenTitle"))
        lay.addWidget(label("영상을 확인하시고, 인스타그램에는 직접 올려주세요.",
                            name="ScreenSub"))

        c = card()
        cl = vbox(c, pad=24, gap=16)
        cl.addWidget(label("할머니 손칼국수 · 23초 · 1080×1920", name="SectionHead"))
        row = hbox()
        for text in ("영상 재생", "폴더 열기", "장면 다시 만들기"):
            b = QPushButton(text)
            b.setObjectName("Secondary")
            row.addWidget(b)
        row.addStretch(1)
        cl.addLayout(row)
        cl.addWidget(NoticeBox(
            "장면을 다시 만들면 AI 사용료가 추가로 발생할 수 있습니다.\n"
            "다시 만들기를 누르면 얼마가 드는지 먼저 알려드립니다.",
            tone="warn", title="다시 만들기 전에"))
        lay.addWidget(c)
        lay.addStretch(1)

        foot = hbox()
        again = QPushButton("새 영상 만들기")
        again.setObjectName("Secondary")
        again.clicked.connect(lambda: self.go(self.STEP_INPUT))
        foot.addWidget(again)
        foot.addStretch(1)
        lay.addLayout(foot)
        return page
