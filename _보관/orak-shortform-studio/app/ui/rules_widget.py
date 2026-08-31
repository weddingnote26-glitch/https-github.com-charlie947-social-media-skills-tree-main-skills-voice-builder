"""「기본 제작 필수 규칙」 화면 조각 (2026-08-29 지시).

지시서가 「설정 화면 또는 별도 메뉴에」 라고 해서 **설정 화면 안**에 넣었습니다.
메뉴를 늘리면 Stage 2 에서 못 박아 둔 「메뉴 4개」 가 깨집니다.

나중에 따로 떼고 싶으면 이 위젯을 그대로 새 화면에 넣으면 됩니다 —
설정 화면에 눌어붙지 않게 따로 만들어 두었습니다.
"""

from __future__ import annotations

from typing import Callable, Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QFrame,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QTextEdit,
    QWidget,
)

from app.core.rules import ALL_SCOPES, SCOPE_LABELS, Rule, RuleScope
from app.services.prompt_builder import ProductionContext
from app.services.rules_service import ProductionRulesService
from app.ui import theme
from app.ui.widgets import NoticeBox, card, hbox, label, vbox

PREVIEW_SCOPES = (RuleScope.SCRIPT, RuleScope.IMAGE, RuleScope.CAPTION,
                  RuleScope.PLAN, RuleScope.RESEARCH, RuleScope.ANALYSIS)


class RuleRow(QFrame):
    """규칙 한 줄. 켜기/끄기 · 어디에 쓸지 · 지우기."""

    def __init__(self, rule: Rule, *, on_toggle: Callable[[int, bool], None],
                 on_remove: Callable[[int], None]) -> None:
        super().__init__()
        self.setObjectName("RuleRow")
        self.rule = rule
        self.setStyleSheet(
            f"QFrame#RuleRow {{ border: 1px solid {theme.LINE};"
            f" border-radius: 8px; background: {theme.CARD}; }}"
            "QFrame#RuleRow QLabel { border: none; background: transparent; }"
            "QFrame#RuleRow QCheckBox { border: none; background: transparent; }")
        lay = hbox(self, pad=12, gap=10)

        self.on_box = QCheckBox()
        self.on_box.setChecked(rule.enabled)
        self.on_box.setToolTip("끄면 이 규칙은 제작에 반영되지 않습니다.")
        self.on_box.toggled.connect(
            lambda on: on_toggle(int(rule.rule_id or 0), on))
        lay.addWidget(self.on_box)

        글 = label(rule.body)
        글.setWordWrap(True)
        lay.addWidget(글, 1)

        쓰는곳 = ", ".join(SCOPE_LABELS[s] for s in rule.scopes)
        if len(rule.scopes) == len(ALL_SCOPES):
            쓰는곳 = "모든 단계"
        lay.addWidget(label(쓰는곳, name="Hint", wrap=False))

        지우기 = QPushButton("지우기")
        지우기.setObjectName("Secondary")
        지우기.clicked.connect(lambda: on_remove(int(rule.rule_id or 0)))
        lay.addWidget(지우기)


class RulesPanel(QWidget):
    """규칙 전체 화면.

    담당자가 할 수 있는 것: 보기 · 넣기 · 켜고 끄기 · 지우기 ·
    기본값 불러오기 · 어디에 반영할지 고르기 · 미리보기 · 자동 반영 켜고 끄기.
    """

    def __init__(self, service: Optional[ProductionRulesService] = None) -> None:
        super().__init__()
        self.service = service
        lay = vbox(self, pad=0)

        머리 = hbox()
        머리.addWidget(label("기본 제작 필수 규칙", name="SectionHead", wrap=False))
        머리.addStretch(1)
        self.auto_box = QCheckBox("제작할 때 자동으로 반영")
        self.auto_box.setChecked(True)
        self.auto_box.toggled.connect(self._set_auto)
        머리.addWidget(self.auto_box)
        lay.addLayout(머리)

        lay.addWidget(label(
            "여기 적어 둔 것이 대본·이미지·게시글을 만들 때 함께 전달됩니다. "
            "메모가 아니라 실제로 쓰입니다.", name="Hint"))

        if self.service is None:
            lay.addWidget(NoticeBox(
                "규칙은 프로그램을 켰을 때 불러옵니다.",
                tone="info", title="아직 불러오지 않았습니다"))
            self.rows_host = QWidget()
            lay.addWidget(self.rows_host)
            return

        # ── 새 규칙 넣기 ──
        넣기 = card()
        n = vbox(넣기)
        n.addWidget(label("규칙 넣기", name="SectionHead", wrap=False))
        줄 = hbox()
        self.section_box = QComboBox()
        self.section_box.setEditable(True)
        self.section_box.addItems(self.service.sections())
        self.section_box.setMinimumWidth(190)
        줄.addWidget(self.section_box)
        self.body_input = QLineEdit()
        self.body_input.setPlaceholderText("지킬 내용을 한 줄로 적어주세요")
        줄.addWidget(self.body_input, 1)
        넣기버튼 = QPushButton("넣기")
        넣기버튼.clicked.connect(self._add)
        줄.addWidget(넣기버튼)
        n.addLayout(줄)

        고를곳 = hbox()
        고를곳.addWidget(label("어디에 반영할까요", name="Hint", wrap=False))
        self.scope_boxes: dict[RuleScope, QCheckBox] = {}
        for s in ALL_SCOPES:
            b = QCheckBox(SCOPE_LABELS[s])
            b.setChecked(True)
            self.scope_boxes[s] = b
            고를곳.addWidget(b)
        고를곳.addStretch(1)
        n.addLayout(고를곳)
        self.add_error = label("", wrap=False)
        self.add_error.setStyleSheet(
            f"color: {theme.BAD}; font-weight: 600; background: transparent;")
        self.add_error.setVisible(False)
        n.addWidget(self.add_error)
        lay.addWidget(넣기)

        # ── 목록 ──
        도구 = hbox()
        self.count_label = label("", name="Hint", wrap=False)
        도구.addWidget(self.count_label)
        도구.addStretch(1)
        기본값 = QPushButton("기본값 불러오기")
        기본값.setObjectName("Secondary")
        기본값.setToolTip("빠진 기본 규칙만 채웁니다. 고쳐 둔 것은 그대로 둡니다.")
        기본값.clicked.connect(self._load_defaults)
        도구.addWidget(기본값)
        lay.addLayout(도구)

        self.rows_host = QWidget()
        self.rows_lay = vbox(self.rows_host, pad=0, gap=8)
        보기 = QScrollArea()
        보기.setWidgetResizable(True)
        보기.setWidget(self.rows_host)
        보기.setMinimumHeight(240)
        lay.addWidget(보기, 1)

        # ── 미리보기 ──
        미리 = card()
        m = vbox(미리)
        머리2 = hbox()
        머리2.addWidget(label("규칙 미리보기", name="SectionHead", wrap=False))
        머리2.addStretch(1)
        self.preview_pick = QComboBox()
        for s in PREVIEW_SCOPES:
            self.preview_pick.addItem(SCOPE_LABELS[s], s.value)
        self.preview_pick.currentIndexChanged.connect(lambda _: self._refresh_preview())
        머리2.addWidget(self.preview_pick)
        m.addLayout(머리2)
        m.addWidget(label(
            "고른 단계에서 실제로 전달될 글입니다. 보이는 그대로 갑니다.", name="Hint"))
        self.preview = QTextEdit()
        self.preview.setReadOnly(True)
        self.preview.setMinimumHeight(150)
        m.addWidget(self.preview)
        lay.addWidget(미리)

        self.reload()

    # ── 동작 ──────────────────────────────────────────────
    def reload(self) -> None:
        if self.service is None:
            return
        self.auto_box.blockSignals(True)
        self.auto_box.setChecked(self.service.auto_apply)
        self.auto_box.blockSignals(False)

        while self.rows_lay.count():
            it = self.rows_lay.takeAt(0)
            if it.widget():
                it.widget().deleteLater()

        규칙들 = self.service.all()
        지금항목 = ""
        for r in 규칙들:
            if r.section != 지금항목:
                지금항목 = r.section
                self.rows_lay.addWidget(label(지금항목, name="SectionHead", wrap=False))
            self.rows_lay.addWidget(
                RuleRow(r, on_toggle=self._toggle, on_remove=self._remove))
        self.rows_lay.addStretch(1)

        켜진것 = sum(1 for r in 규칙들 if r.enabled)
        self.count_label.setText(f"규칙 {len(규칙들)}개 · 켜진 것 {켜진것}개")
        self._refresh_preview()

    def _refresh_preview(self) -> None:
        if self.service is None:
            return
        고른것 = RuleScope(self.preview_pick.currentData()
                         or RuleScope.SCRIPT.value)
        self.preview.setPlainText(
            self.service.preview(고른것, ProductionContext()))

    def _add(self) -> None:
        if self.service is None:
            return
        고른곳 = tuple(s for s, b in self.scope_boxes.items() if b.isChecked())
        try:
            self.service.add(self.section_box.currentText(),
                             self.body_input.text(), 고른곳 or ALL_SCOPES)
        except ValueError as e:
            self.add_error.setText(str(e))
            self.add_error.setVisible(True)
            return
        self.add_error.setVisible(False)
        self.body_input.clear()
        self.reload()

    def _toggle(self, rule_id: int, on: bool) -> None:
        if self.service is not None and rule_id:
            self.service.set_enabled(rule_id, on)
            self.reload()

    def _remove(self, rule_id: int) -> None:
        if self.service is not None and rule_id:
            self.service.remove(rule_id)
            self.reload()

    def _load_defaults(self) -> None:
        if self.service is not None:
            self.service.load_defaults()
            self.reload()

    def _set_auto(self, on: bool) -> None:
        if self.service is not None:
            self.service.auto_apply = on
            self._refresh_preview()
