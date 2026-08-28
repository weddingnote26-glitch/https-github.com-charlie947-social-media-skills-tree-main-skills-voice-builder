"""캐릭터 — 오락이 설정이 제대로 준비됐는지 봅니다 (지시서 §3).

이 화면은 ``assets/character_profile.json`` 을 **읽기만** 합니다.
쓰지 않습니다. 고치실 때는 그 파일을 메모장으로 여시면 됩니다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from PySide6.QtWidgets import QGridLayout, QLabel, QScrollArea, QWidget

from app.ui import theme
from app.ui.widgets import NoticeBox, card, hbox, label, vbox

PROFILE_PATH = Path(__file__).resolve().parents[3] / "assets" / "character_profile.json"
MASTER_DIR = PROFILE_PATH.parent / "master"
PLACEHOLDER = "__사장님_확인_필요__"


def _load() -> dict[str, Any]:
    try:
        return json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    except Exception:
        # 화면에는 개발자 오류를 띄우지 않습니다 (§9). 빈 값으로 두고 안내만 합니다.
        return {}


def _badge(text: str, ok: bool) -> QLabel:
    fg, bg = (theme.OK, theme.OK_SOFT) if ok else (theme.BAD, theme.BAD_SOFT)
    lb = QLabel(text)
    lb.setStyleSheet(
        f"background: {bg}; color: {fg}; border-radius: 11px;"
        f" padding: 4px 12px; font-size: {theme.FS_SMALL}px; font-weight: 700;"
    )
    return lb


class CharacterScreen(QWidget):
    def __init__(self) -> None:
        super().__init__()
        profile = _load()

        lay = vbox(self, pad=theme.PAD_L)
        lay.addWidget(label("캐릭터", name="ScreenTitle"))
        lay.addWidget(label("장면마다 오락이가 같은 모습으로 나오게 하는 설정입니다.",
                            name="ScreenSub"))

        body = QWidget()
        bl = vbox(body, pad=0)

        # ── 마스터 이미지 3장 ──
        masters = profile.get("마스터이미지", {})
        c1 = card()
        l1 = vbox(c1)
        l1.addWidget(label("기준 이미지 3장", name="SectionHead"))
        l1.addWidget(label(
            "장면을 만들 때마다 이 3장을 모두 참고합니다. 한 장만 넣는 것보다 훨씬 안정적입니다.",
            name="Hint"))
        self.missing_masters: list[str] = []
        for key in ("주", "보조1", "보조2"):
            item = masters.get(key, {})
            fname = item.get("파일", "—")
            exists = (MASTER_DIR / fname).exists() if fname != "—" else False
            if not exists:
                self.missing_masters.append(fname)
            row = hbox()
            name_lb = label(fname, wrap=False)
            name_lb.setFixedWidth(190)
            row.addWidget(name_lb)
            reason = item.get("고른이유", "")
            if reason:
                row.addWidget(label(reason, name="Hint", wrap=False), 1)
            row.addStretch(1)
            row.addWidget(_badge("있음" if exists else "아직 없음", exists))
            l1.addLayout(row)
        if self.missing_masters:
            l1.addWidget(NoticeBox(
                "이미지를 넣는 방법은 「assets › master」 폴더 안의 "
                "「여기에_넣어주세요.txt」 에 적어두었습니다.\n"
                "넣기 전에 저장소를 비공개로 바꾸셔야 합니다.",
                tone="bad", title="기준 이미지가 아직 없습니다"))
        bl.addWidget(c1)

        # ── 색깔 6칸 ──
        colors = profile.get("고정", {}).get("대표색상", {})
        empty = [k for k, v in colors.items() if v == PLACEHOLDER]
        c2 = card()
        l2 = vbox(c2)
        l2.addWidget(label("고정할 색", name="SectionHead"))
        grid = QGridLayout()
        grid.setHorizontalSpacing(24)
        grid.setVerticalSpacing(8)
        for i, (k, v) in enumerate(colors.items()):
            filled = v != PLACEHOLDER
            grid.addWidget(label(k.replace("_", " "), name="FieldLabel", wrap=False), i, 0)
            grid.addWidget(label(v if filled else "아직 안 적으셨습니다",
                                 name="" if filled else "Hint", wrap=False), i, 1)
            grid.addWidget(_badge("적음" if filled else "비었음", filled), i, 2)
        grid.setColumnStretch(1, 1)
        l2.addLayout(grid)
        if empty:
            l2.addWidget(NoticeBox(
                f"{len(empty)}칸이 비어 있습니다. 「assets › character_profile.json」 을 "
                "메모장으로 열어 색을 적어주세요.\n"
                "비어 있으면 장면마다 색이 달라질 수 있습니다.",
                tone="warn", title="채워주셔야 합니다"))
        bl.addWidget(c2)

        # ── 고정 / 변경 가능 ──
        c3 = card()
        l3 = vbox(c3)
        l3.addWidget(label("장면이 바뀌어도 그대로인 것", name="SectionHead"))
        for item in profile.get("고정", {}).get("항목_한국어", []):
            l3.addWidget(label(f"·  {item}"))
        l3.addWidget(label("장면마다 바뀌어도 되는 것", name="SectionHead"))
        l3.addWidget(label("·  " + "   ·  ".join(profile.get("변경가능", []))))
        bl.addWidget(c3)

        # ── 구도 규칙 ──
        comp = profile.get("구도", {})
        rng = comp.get("캐릭터_세로범위_퍼센트", [])
        c4 = card()
        l4 = vbox(c4)
        l4.addWidget(label("화면 구도", name="SectionHead"))
        if rng:
            l4.addWidget(label(
                f"오락이는 화면 위 {rng[0]}% 에서 {rng[1]}% 사이에 둡니다. "
                f"아래 {comp.get('하단_배경만_퍼센트', 35)}% 는 배경만 둡니다."))
        l4.addWidget(label(
            "자막이 들어갈 자리를 비워두는 것입니다. 이 규칙이 없으면 자막이 옷 위에 얹히고, "
            "릴스 화면에서는 신발이 앱 버튼에 가립니다.", name="Hint"))
        bl.addWidget(c4)

        bl.addStretch(1)
        sa = QScrollArea()
        sa.setWidgetResizable(True)
        sa.setWidget(body)
        lay.addWidget(sa, 1)
