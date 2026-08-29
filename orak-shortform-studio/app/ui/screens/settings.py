"""설정 — 열쇠와 한도.

Stage 3 에서 열쇠 금고를 붙였습니다.

- **윈도우**: 칸이 열립니다. 넣으면 DPAPI 로 잠가서 보관하고, 다시 켜도 읽힙니다.
- **그 밖**: 칸이 잠깁니다. 안전한 척하지 않고 「윈도우에서만 됩니다」 라고 알립니다.

화면에는 언제나 ``sk-...★★★★`` 형태만 보입니다. 원문은 어디에도 표시하지 않습니다 (§10-3).
"""

from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtWidgets import (
    QComboBox,
    QFormLayout,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QWidget,
)

from app.core.paths import Paths
from app.core.secrets import CredentialStore, VaultUnavailable, open_vault
from app.ui import theme
from app.ui.widgets import NoticeBox, card, field_label, hbox, label, vbox

PRICING_PATH = Path(__file__).resolve().parents[3] / "assets" / "pricing.json"

KEYS = [
    ("claude", "대본 만들기 (Claude)", "카드뉴스 프로그램과 다른 키를 쓰세요"),
    ("kling", "영상 만들기 (Kling)", "한 번만 보여주므로 발급할 때 복사해 두세요"),
    ("gemini", "이미지 만들기 (Gemini)", ""),
    ("elevenlabs", "목소리 (ElevenLabs)", ""),
]


def _limits() -> dict:
    try:
        return json.loads(PRICING_PATH.read_text(encoding="utf-8")).get("한도", {})
    except Exception:
        return {}


class SettingsScreen(QWidget):
    def __init__(self, vault: CredentialStore | None = None) -> None:
        """``vault`` 를 주면 그걸 씁니다. 안 주면 이 컴퓨터에서 열 수 있는지 봅니다.

        시험은 잠금장치를 갈아끼운 금고를 넣어 리눅스에서도 흐름을 확인합니다.
        """
        super().__init__()
        self.vault = vault
        self.vault_error = ""
        if self.vault is None:
            try:
                self.vault = open_vault(Paths().credentials_path())
            except VaultUnavailable as e:
                self.vault_error = e.user_message

        lay = vbox(self, pad=theme.PAD_L)
        lay.addWidget(label("설정", name="ScreenTitle"))
        lay.addWidget(label("열쇠와 한도를 정하는 곳입니다.", name="ScreenSub"))

        body = QWidget()
        bl = vbox(body, pad=0)

        # ── 열쇠 ──
        c1 = card()
        l1 = vbox(c1)
        l1.addWidget(label("열쇠 (API 키)", name="SectionHead"))
        form = QFormLayout()
        form.setSpacing(12)
        self.key_inputs: dict[str, QLineEdit] = {}
        self.key_states: dict[str, object] = {}
        열림 = self.vault is not None
        for key, name, hint in KEYS:
            row = QWidget()
            rl = hbox(row, pad=0, gap=10)
            line = QLineEdit()
            line.setEchoMode(QLineEdit.Password)
            line.setEnabled(열림)
            line.setPlaceholderText(
                "여기에 붙여넣고 [저장] 을 누르세요" if 열림
                else "이 컴퓨터에서는 넣을 수 없습니다")
            rl.addWidget(line, 1)
            save = QPushButton("저장")
            save.setObjectName("Secondary")
            save.setEnabled(열림)
            save.clicked.connect(lambda _=False, k=key: self._save_key(k))
            rl.addWidget(save)

            state = label(self._key_state_text(key), name="Hint", wrap=False)
            self.key_inputs[key] = line
            self.key_states[key] = state

            form.addRow(field_label(name, width=theme.FIELD_LABEL_W_WIDE), row)
            form.addRow(field_label("", width=theme.FIELD_LABEL_W_WIDE), state)
            if hint:
                form.addRow(field_label("", width=theme.FIELD_LABEL_W_WIDE),
                            label(hint, name="Hint"))
        l1.addLayout(form)
        if self.vault_error:
            l1.addWidget(NoticeBox(
                self.vault_error + "\n"
                "사장님 윈도우 PC 에서는 이 칸이 열립니다.",
                tone="warn", title="여기서는 열쇠를 넣을 수 없습니다"))
        l1.addWidget(NoticeBox(
            "열쇠는 윈도우 금고에 잠가서 보관합니다. 화면에는 언제나 sk-…★★★★ 로만 보입니다.\n"
            "기록 파일·백업·깃허브 어디에도 원문이 남지 않습니다.",
            tone="info", title="열쇠는 이렇게 지킵니다"))
        bl.addWidget(c1)

        # ── 모델 ──
        c2 = card()
        l2 = vbox(c2)
        l2.addWidget(label("쓸 모델", name="SectionHead"))
        f2 = QFormLayout()
        f2.setSpacing(12)
        for name, items in [
            ("대본", ["아직 정하지 않았습니다"]),
            ("영상", ["kling-2.6"]),
            ("이미지", ["gemini-3.1-flash-image"]),
            ("목소리", ["연결한 뒤 목록을 불러옵니다"]),
        ]:
            combo = QComboBox()
            combo.addItems(items)
            combo.setEnabled(False)
            f2.addRow(field_label(name, width=theme.FIELD_LABEL_W_WIDE), combo)
        l2.addLayout(f2)
        l2.addWidget(label(
            "모델 이름은 프로그램 안에 박아두지 않습니다. 서비스가 바뀌면 여기서 고칩니다.",
            name="Hint"))
        bl.addWidget(c2)

        # ── 한도 ──
        limits = _limits()
        c3 = card()
        l3 = vbox(c3)
        l3.addWidget(label("한도", name="SectionHead"))
        f3 = QFormLayout()
        f3.setSpacing(12)
        for text, value in [
            ("한 달에 쓸 수 있는 돈", f"{limits.get('월_한도_원', 50000):,}원"),
            ("경고를 띄우는 시점", f"{limits.get('경고_퍼센트', 80)}%"),
            ("아예 막는 시점", f"{limits.get('차단_퍼센트', 100)}%"),
            ("한 편에 만들 영상 장면", f"{limits.get('1편_최대_Kling클립수', 2)}개 "
                                      f"(최대 {limits.get('1편_최대_Kling클립수_상한', 3)}개)"),
        ]:
            f3.addRow(field_label(text, width=theme.FIELD_LABEL_W_WIDE),
                      label(value, wrap=False))
        l3.addLayout(f3)
        l3.addWidget(label(
            "이 값은 「assets › pricing.json」 에서 읽어온 것입니다.", name="Hint"))
        bl.addWidget(c3)

        # ── 배경음악 ──
        c4 = card()
        l4 = vbox(c4)
        l4.addWidget(label("배경음악", name="SectionHead"))
        row = hbox()
        row.addWidget(label("「assets › bgm」 폴더에 직접 넣어주세요."))
        row.addStretch(1)
        l4.addLayout(row)
        l4.addWidget(NoticeBox(
            "상업적 이용이 가능한 음원만 넣어주세요. 저작권 문제가 생기면 계정이 제재될 수 있습니다.",
            tone="warn", title="꼭 확인해 주세요"))
        bl.addWidget(c4)

        bl.addStretch(1)
        sa = QScrollArea()
        sa.setWidgetResizable(True)
        sa.setWidget(body)
        lay.addWidget(sa, 1)

    # ── 열쇠 저장 ─────────────────────────────────────────
    def _key_state_text(self, key: str) -> str:
        if self.vault is None:
            return "아직 넣지 않았습니다"
        try:
            return f"지금 들어 있는 열쇠  {self.vault.hint(key)}"
        except VaultUnavailable as e:
            return e.user_message

    def _save_key(self, key: str) -> None:
        """넣은 값을 금고에 잠급니다. **입력칸은 곧바로 비웁니다.**

        화면에 원문이 남아 있으면 어깨너머로 보입니다.
        """
        line = self.key_inputs[key]
        value = line.text().strip()
        state = self.key_states[key]
        if not value:
            state.setText("빈 칸입니다. 열쇠를 붙여넣어 주세요.")
            return
        try:
            self.vault.put(key, value)
        except Exception:
            # 원인을 화면에 띄우지 않습니다 (§9).
            state.setText("열쇠를 저장하지 못했습니다. 회사에 문의해 주세요.")
            return
        line.clear()
        state.setText(self._key_state_text(key))
