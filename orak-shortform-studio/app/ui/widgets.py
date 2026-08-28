"""화면 여러 곳에서 되풀이되는 조각들.

지시서 §9의 화면 규칙을 위젯 안에 넣어두었습니다.
그래야 화면을 새로 만들 때마다 규칙을 다시 떠올리지 않아도 됩니다.
"""

from __future__ import annotations

from typing import Callable, Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from app.ui import theme


# ─────────────────────────────────────────────────────────────
# 기본 조각
# ─────────────────────────────────────────────────────────────


def label(text: str, *, name: str = "", wrap: bool = True) -> QLabel:
    lb = QLabel(text)
    if name:
        lb.setObjectName(name)
    lb.setWordWrap(wrap)
    lb.setTextInteractionFlags(Qt.TextSelectableByMouse)
    return lb


def field_label(text: str, *, required: bool = False,
                width: int = theme.FIELD_LABEL_W) -> QLabel:
    """입력칸 이름. 필수면 ● 를 강조색으로 붙입니다.

    너비를 고정하는 이유는 입력칸 왼쪽 끝을 줄마다 맞추기 위해서입니다.
    ``width`` 는 화면마다 다르게 줄 수 있습니다 — 이름이 길면 넓게 주세요.
    너무 좁으면 글자가 잘리는데, ``tests/test_ui_flow.py`` 가 그걸 잡아냅니다.
    """
    mark = (f' <span style="color:{theme.ACCENT};">●</span>' if required else "")
    lb = QLabel(f"{text}{mark}")
    lb.setObjectName("FieldLabel")
    lb.setTextFormat(Qt.RichText)
    lb.setWordWrap(False)
    lb.setFixedWidth(width)
    return lb


def card() -> QFrame:
    """흰 배경 카드. 안에 레이아웃을 직접 넣어 쓰세요."""
    f = QFrame()
    f.setObjectName("Card")
    return f


def vbox(parent: Optional[QWidget] = None, *, pad: int = theme.PAD,
         gap: int = theme.GAP) -> QVBoxLayout:
    lay = QVBoxLayout(parent) if parent is not None else QVBoxLayout()
    lay.setContentsMargins(pad, pad, pad, pad)
    lay.setSpacing(gap)
    return lay


def hbox(parent: Optional[QWidget] = None, *, pad: int = 0,
         gap: int = theme.GAP) -> QHBoxLayout:
    lay = QHBoxLayout(parent) if parent is not None else QHBoxLayout()
    lay.setContentsMargins(pad, pad, pad, pad)
    lay.setSpacing(gap)
    return lay


def spacer() -> QWidget:
    w = QWidget()
    w.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
    return w


# ─────────────────────────────────────────────────────────────
# 안내 상자
# ─────────────────────────────────────────────────────────────


class NoticeBox(QFrame):
    """담당자에게 무언가 알려주는 상자.

    ``tone`` 에 따라 왼쪽 색 막대와 배경이 달라집니다.
    글은 **한국어 평문**으로만 씁니다. 영어·전문용어·오류코드 금지 (§9).

    왼쪽 막대는 CSS ``border-left`` 가 아니라 **진짜 위젯**입니다.
    둥근 모서리와 한쪽 테두리를 같이 주면 Qt 가 괄호 모양 자국을 남깁니다.
    """

    TONES = {
        "info": (theme.INK_SOFT, theme.CARD_ALT),
        "ok": (theme.OK, theme.OK_SOFT),
        "warn": (theme.WARN, theme.WARN_SOFT),
        "bad": (theme.BAD, theme.BAD_SOFT),
    }

    def __init__(self, text: str, *, tone: str = "info", title: str = "") -> None:
        super().__init__()
        bar_color, bg = self.TONES.get(tone, self.TONES["info"])
        self.setStyleSheet(
            f"QFrame#NoticeShell {{ background: {bg}; border: none;"
            f" border-radius: 6px; }}"
        )
        self.setObjectName("NoticeShell")

        outer = hbox(self, pad=0, gap=0)

        bar = QFrame()
        bar.setFixedWidth(4)
        bar.setStyleSheet(f"background: {bar_color}; border: none; border-radius: 2px;")
        outer.addWidget(bar)

        content = QWidget()
        content.setStyleSheet("background: transparent;")
        lay = vbox(content, pad=14, gap=5)
        if title:
            t = label(title)
            t.setStyleSheet(
                f"font-size: {theme.FS_BODY}px; font-weight: 700;"
                f" color: {bar_color}; background: transparent;"
            )
            lay.addWidget(t)
        body = label(text)
        body.setStyleSheet(
            f"font-size: {theme.FS_SMALL}px; color: {theme.INK_SOFT};"
            f" background: transparent;"
        )
        lay.addWidget(body)
        outer.addWidget(content, 1)


class ErrorBox(QFrame):
    """실패를 알리는 상자. **[다시 시도] 버튼이 함께 있어야 합니다.**

    지시서 §9: 개발자 로그를 담당자에게 보여주지 마세요.
    stack trace · HTTP 상태코드 · JSON 원문 금지.
    상세는 ``Logs\\`` 폴더에만 남깁니다.
    """

    def __init__(self, message: str, *, on_retry: Optional[Callable[[], None]] = None,
                 retry_text: str = "다시 시도") -> None:
        super().__init__()
        self.setObjectName("ErrorShell")
        self.setStyleSheet(
            f"QFrame#ErrorShell {{ background: {theme.BAD_SOFT}; border: none;"
            f" border-radius: 6px; }}"
        )
        outer = hbox(self, pad=0, gap=0)

        bar = QFrame()
        bar.setFixedWidth(4)
        bar.setStyleSheet(f"background: {theme.BAD}; border: none; border-radius: 2px;")
        outer.addWidget(bar)

        content = QWidget()
        content.setStyleSheet("background: transparent;")
        lay = vbox(content, pad=14, gap=10)
        msg = label(message)
        msg.setStyleSheet(
            f"font-size: {theme.FS_BODY}px; font-weight: 600;"
            f" color: {theme.BAD}; background: transparent;"
        )
        lay.addWidget(msg)

        row = hbox(gap=10)
        self.retry_button = QPushButton(retry_text)
        self.retry_button.setObjectName("Secondary")
        if on_retry is not None:
            self.retry_button.clicked.connect(on_retry)
        row.addWidget(self.retry_button)
        row.addStretch(1)
        lay.addLayout(row)
        outer.addWidget(content, 1)


# ─────────────────────────────────────────────────────────────
# 버튼
# ─────────────────────────────────────────────────────────────


class BusyButton(QPushButton):
    """AI 를 부르는 버튼.

    지시서 §9: **중복 클릭을 막으세요.** 진행 중이면 버튼을 비활성화하고
    같은 작업을 다시 요청하지 않게 합니다.

    한 번 누르면 스스로 잠기고, 일이 끝났을 때 ``finish()`` 를 불러야 풀립니다.
    부르는 쪽이 깜빡해도 잠긴 채로 남으므로 **돈이 두 번 나가지 않습니다.**
    """

    def __init__(self, text: str, *, busy_text: str = "만드는 중입니다…",
                 primary: bool = True) -> None:
        super().__init__(text)
        self.setObjectName("Primary" if primary else "Secondary")
        self._idle_text = text
        self._busy_text = busy_text
        self._busy = False
        self.clicked.connect(self._lock)

    @property
    def is_busy(self) -> bool:
        return self._busy

    def _lock(self) -> None:
        self._busy = True
        self.setEnabled(False)
        self.setText(self._busy_text)

    def finish(self, *, text: Optional[str] = None) -> None:
        """일이 끝났다. 버튼을 되돌린다."""
        self._busy = False
        self.setEnabled(True)
        self.setText(text or self._idle_text)


# ─────────────────────────────────────────────────────────────
# 진행 단계 표시
# ─────────────────────────────────────────────────────────────


class StepTrail(QWidget):
    """진행 상황을 한 줄로 보여줍니다 (§9).

        대본 완료 → 이미지 생성 → 영상 생성 → 음성 생성 → 자막 생성 → 최종 합성
    """

    def __init__(self, steps: list[str]) -> None:
        super().__init__()
        self._steps = steps
        self._dots: list[QLabel] = []
        self._names: list[QLabel] = []

        lay = hbox(self, gap=0)
        for i, name in enumerate(steps):
            if i:
                sep = QLabel("›")
                sep.setStyleSheet(
                    f"color: {theme.LINE_STRONG}; font-size: {theme.FS_HEAD}px;"
                )
                lay.addWidget(sep)
            cell = QWidget()
            cl = vbox(cell, pad=8, gap=3)
            cl.setAlignment(Qt.AlignHCenter)
            dot = QLabel("○")
            dot.setAlignment(Qt.AlignHCenter)
            nm = QLabel(name)
            nm.setAlignment(Qt.AlignHCenter)
            cl.addWidget(dot)
            cl.addWidget(nm)
            self._dots.append(dot)
            self._names.append(nm)
            lay.addWidget(cell)
        lay.addStretch(1)
        self.set_current(-1)

    def set_current(self, index: int) -> None:
        """index 앞은 완료, index 는 진행 중, 뒤는 대기."""
        for i, (dot, nm) in enumerate(zip(self._dots, self._names)):
            if i < index:
                dot.setText("●")
                color, weight = theme.OK, 600
            elif i == index:
                dot.setText("◉")
                color, weight = theme.ACCENT, 700
            else:
                dot.setText("○")
                color, weight = theme.INK_FAINT, 400
            dot.setStyleSheet(f"color: {color}; font-size: {theme.FS_HEAD}px;")
            nm.setStyleSheet(
                f"color: {color}; font-size: {theme.FS_SMALL}px; font-weight: {weight};"
            )


# ─────────────────────────────────────────────────────────────
# 아래 비용 표시줄
# ─────────────────────────────────────────────────────────────


class CostBar(QWidget):
    """창 맨 아래에 **항상** 보이는 이번 달 사용액 (§11).

        이번 달 누적 21,000원 / 50,000원

    80% 넘으면 주황, 100% 넘으면 빨강으로 바뀌고 안내 문구가 붙습니다.
    """

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("CostBar")
        self.setFixedHeight(56)
        lay = hbox(self, pad=0, gap=12)
        lay.setContentsMargins(theme.PAD_L, 0, theme.PAD_L, 0)

        self._text = QLabel()
        self._text.setObjectName("CostText")
        self._note = QLabel()
        self._note.setObjectName("CostNote")
        lay.addWidget(self._text)
        lay.addWidget(self._note)
        lay.addStretch(1)

        self._stage = QLabel("Stage 2 — 화면만 만든 상태입니다")
        self._stage.setObjectName("CostNote")
        lay.addWidget(self._stage)

        self.set_usage(0, 50000)

    def set_usage(self, used_krw: int, limit_krw: int) -> None:
        pct = (used_krw / limit_krw * 100) if limit_krw else 0
        self._text.setText(f"이번 달 누적 {used_krw:,}원 / {limit_krw:,}원")
        if pct >= 100:
            color, note = theme.BAD, "이번 달 한도에 도달했습니다. 회사에 문의해 주세요."
        elif pct >= 80:
            color, note = theme.WARN, "한도의 80%를 넘었습니다."
        else:
            color, note = theme.INK, ""
        self._text.setStyleSheet(
            f"font-size: {theme.FS_BODY}px; font-weight: 700; color: {color};"
        )
        self._note.setText(note)
        self._note.setStyleSheet(f"font-size: {theme.FS_SMALL}px; color: {color};")
