# -*- coding: utf-8 -*-
"""화면마다 되풀이해 쓰는 조각들."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame, QHBoxLayout, QLabel, QMessageBox, QPlainTextEdit,
    QProgressBar, QPushButton, QVBoxLayout, QWidget,
)

from . import theme


def title(text: str) -> QLabel:
    lb = QLabel(text)
    lb.setObjectName("Title")
    return lb


def lead(text: str) -> QLabel:
    lb = QLabel(text)
    lb.setObjectName("Lead")
    lb.setWordWrap(True)
    return lb


def button(text: str, kind: str = "", tip: str = "") -> QPushButton:
    b = QPushButton(text)
    if kind:
        b.setObjectName(kind)          # Primary / Danger
    b.setMinimumHeight(theme.BTN_H)
    b.setCursor(Qt.PointingHandCursor)
    if tip:
        b.setToolTip(tip)
    return b


class Card(QFrame):
    """제목 한 줄 + 내용이 들어가는 상자."""

    def __init__(self, heading: str = "", parent=None):
        super().__init__(parent)
        self.setObjectName("Card")
        self.box = QVBoxLayout(self)
        self.box.setContentsMargins(22, 18, 22, 18)
        self.box.setSpacing(12)
        if heading:
            h = QLabel(heading)
            h.setObjectName("CardTitle")
            self.box.addWidget(h)

    def add(self, w: QWidget) -> QWidget:
        self.box.addWidget(w)
        return w


class StatRow(QWidget):
    """홈 화면의 '큰 숫자 + 설명' 한 칸."""

    def __init__(self, big: str, small: str, parent=None):
        super().__init__(parent)
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(4)
        self.big = QLabel(big)
        self.big.setObjectName("CardBig")
        self.small = QLabel(small)
        self.small.setObjectName("Lead")
        self.small.setWordWrap(True)
        v.addWidget(self.big)
        v.addWidget(self.small)

    def set(self, big: str, small: str | None = None) -> None:
        self.big.setText(big)
        if small is not None:
            self.small.setText(small)


class StatusLine(QWidget):
    """색 점 + 글자. 상태를 한눈에 보여 줍니다."""

    def __init__(self, text: str = "", ok: bool | None = None, parent=None):
        super().__init__(parent)
        h = QHBoxLayout(self)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(12)
        self.dot = QLabel("●")
        self.dot.setFixedWidth(26)
        self.label = QLabel(text)
        self.label.setWordWrap(True)
        h.addWidget(self.dot)
        h.addWidget(self.label, 1)
        self.set(text, ok)

    def set(self, text: str, ok: bool | None = None) -> None:
        self.label.setText(text)
        color = theme.SUB if ok is None else (theme.OK if ok else theme.WARN)
        self.dot.setStyleSheet(f"color: {color}; font-size: {theme.FONT_BASE}px;")
        self.label.setStyleSheet(f"color: {theme.INK}; font-size: {theme.FONT_BASE}px;")


class TaskPanel(QWidget):
    """
    긴 작업을 위한 칸 — 진행 막대, 지금 하는 일, 취소, 작업 기록.

    실제 실행은 화면 쪽에서 TaskRunner 로 하고, 이 칸은 보여 주기만 합니다.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(12)

        top = QHBoxLayout()
        top.setSpacing(14)
        self.step = QLabel("준비됨")
        self.step.setStyleSheet(f"font-size: {theme.FONT_BASE}px; color: {theme.INK};")
        self.cancel_btn = button("멈추기", "Danger")
        self.cancel_btn.setVisible(False)
        self.cancel_btn.setMaximumWidth(200)
        top.addWidget(self.step, 1)
        top.addWidget(self.cancel_btn)
        v.addLayout(top)

        self.bar = QProgressBar()
        self.bar.setRange(0, 1)
        self.bar.setValue(0)
        self.bar.setTextVisible(False)
        self.bar.setVisible(False)
        v.addWidget(self.bar)

        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMinimumHeight(200)
        v.addWidget(self.log, 1)

    def start(self, step_text: str) -> None:
        self.log.clear()
        self.step.setText(step_text)
        self.bar.setRange(0, 0)          # 진행률을 모를 때는 흐르는 막대
        self.bar.setVisible(True)
        self.cancel_btn.setVisible(True)

    def append(self, text: str) -> None:
        self.log.appendPlainText(text)
        sb = self.log.verticalScrollBar()
        sb.setValue(sb.maximum())

    def done(self, step_text: str) -> None:
        self.step.setText(step_text)
        self.bar.setVisible(False)
        self.bar.setRange(0, 1)
        self.cancel_btn.setVisible(False)


class SummaryRow(QWidget):
    """성공 · 확인 필요 · 실패 개수를 색 카드 세 장으로 보여 줍니다."""

    def __init__(self, parent=None):
        super().__init__(parent)
        h = QHBoxLayout(self)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(12)
        self.ok = QLabel("성공 0")
        self.ok.setObjectName("SumOK")
        self.warn_ = QLabel("확인 필요 0")
        self.warn_.setObjectName("SumWarn")
        self.fail = QLabel("실패 0")
        self.fail.setObjectName("SumFail")
        for w in (self.ok, self.warn_, self.fail):
            h.addWidget(w)
        h.addStretch(1)

    def set(self, ok: int, warn: int, fail: int) -> None:
        self.ok.setText(f"성공 {ok}")
        self.warn_.setText(f"확인 필요 {warn}")
        self.fail.setText(f"실패 {fail}")


class Collapsible(QWidget):
    """'자세히 보기'를 눌러야 펼쳐지는 칸 — 긴 기록을 숨겨 둡니다."""

    def __init__(self, inner: QWidget, label: str = "자세히 보기", parent=None):
        super().__init__(parent)
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(8)
        self._label = label
        self.btn = QPushButton(f"{label} ▾")
        self.btn.setCursor(Qt.PointingHandCursor)
        self.btn.setMaximumWidth(260)
        self.inner = inner
        self.inner.setVisible(False)
        self.btn.clicked.connect(self._toggle)
        v.addWidget(self.btn)
        v.addWidget(self.inner)

    def _toggle(self) -> None:
        show = not self.inner.isVisible()
        self.inner.setVisible(show)
        self.btn.setText(f"{self._label} {'▴' if show else '▾'}")

    def open(self) -> None:
        if not self.inner.isVisible():
            self._toggle()


# ── 안내창 (검은 화면 대신 이것으로 보여 줍니다) ─────────────
def _box(parent, icon, title_text: str, text: str, detail: str = "") -> QMessageBox:
    m = QMessageBox(parent)
    m.setIcon(icon)
    m.setWindowTitle(title_text)
    m.setText(text)
    if detail:
        m.setDetailedText(detail)
    m.setStyleSheet(f"QLabel {{ font-size: {theme.FONT_BASE}px; }}")
    return m


def info(parent, text: str, detail: str = "") -> None:
    _box(parent, QMessageBox.Information, "알려 드립니다", text, detail).exec()


def warn(parent, text: str, detail: str = "") -> None:
    _box(parent, QMessageBox.Warning, "확인이 필요합니다", text, detail).exec()


def error(parent, text: str, detail: str = "") -> None:
    m = _box(parent, QMessageBox.Critical, "문제가 생겼습니다", text, detail)
    m.exec()


def ask(parent, text: str, ok_text: str = "네, 실행합니다") -> bool:
    m = _box(parent, QMessageBox.Question, "확인해 주세요", text)
    yes = m.addButton(ok_text, QMessageBox.AcceptRole)
    m.addButton("아니요", QMessageBox.RejectRole)
    m.exec()
    return m.clickedButton() is yes
