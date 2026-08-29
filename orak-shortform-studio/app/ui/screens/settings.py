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

from app.core.paths import APP_DIR_NAME, Paths
from app.core.secrets import CredentialStore, VaultUnavailable, open_vault
from app.ui import theme
from app.ui.rules_widget import RulesPanel
from app.ui.widgets import NoticeBox, card, field_label, hbox, label, vbox

PRICING_PATH = Path(__file__).resolve().parents[3] / "assets" / "pricing.json"

KEYS = [
    ("openai", "대본·이미지 (OpenAI)", "대본과 이미지를 한 열쇠로 씁니다"),
    ("elevenlabs", "목소리 (ElevenLabs)", ""),
    ("kling", "영상 만들기 (Kling)", "한 번만 보여주므로 발급할 때 복사해 두세요"),
    ("claude", "대본 만들기 (Claude)", "예전에 쓰던 것입니다. 안 넣어도 됩니다"),
    ("gemini", "이미지 만들기 (Gemini)", "예전에 쓰던 것입니다. 안 넣어도 됩니다"),
]

MODEL_ROWS = [
    ("script", "대본 모델", "openai.script_model",
     "[연결 확인] 을 누르면 쓸 수 있는 목록이 나옵니다"),
    ("image", "이미지 모델", "openai.image_model",
     "[연결 확인] 을 누르면 쓸 수 있는 목록이 나옵니다"),
    ("voice_model", "목소리 모델", "elevenlabs.model",
     "한국어가 되는 것으로 골라주세요"),
    ("voice_id", "쓸 목소리", "elevenlabs.voice_id",
     "일레븐랩스에서 만든 목소리가 나옵니다"),
]


def _limits() -> dict:
    try:
        return json.loads(PRICING_PATH.read_text(encoding="utf-8")).get("한도", {})
    except Exception:
        return {}


class SettingsScreen(QWidget):
    def __init__(self, vault: CredentialStore | None = None,
                 db=None, registry=None) -> None:
        """``vault`` 를 주면 그걸 씁니다. 안 주면 이 컴퓨터에서 열 수 있는지 봅니다.

        시험은 잠금장치를 갈아끼운 금고를 넣어 리눅스에서도 흐름을 확인합니다.
        """
        super().__init__()
        self.vault = vault
        self.db = db
        self.registry = registry
        self.rules_service = None
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
        self.key_deletes: dict[str, QPushButton] = {}
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

            remove = QPushButton("지우기")
            remove.setObjectName("Secondary")
            remove.setEnabled(열림 and self._has(key))
            remove.clicked.connect(lambda _=False, k=key: self._delete_key(k))
            rl.addWidget(remove)
            self.key_deletes[key] = remove

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

        # ── 쓰는 곳 ──
        c0 = card()
        l0 = vbox(c0)
        l0.addWidget(label("무엇으로 만드나요", name="SectionHead"))
        f0 = QFormLayout()
        f0.setSpacing(12)
        for 이름, 값 in [("대본", "OpenAI"), ("이미지", "OpenAI"),
                        ("목소리", "ElevenLabs"), ("영상", "Kling")]:
            f0.addRow(field_label(이름, width=theme.FIELD_LABEL_W_WIDE),
                      label(값, wrap=False))
        l0.addLayout(f0)
        l0.addWidget(label(
            "바꾸려면 회사에 문의해 주세요. 예전에 쓰던 것도 지우지 않고 남겨 두었습니다.",
            name="Hint"))
        bl.addWidget(c0)

        # ── 모델 ──
        #
        # **모델 이름을 프로그램 안에 적어두지 않습니다** (§0-2).
        # [연결 확인] 이 계정에 물어본 목록으로 칸을 채웁니다. 추측하지 않습니다.
        c2 = card()
        l2 = vbox(c2)
        l2.addWidget(label("쓸 모델", name="SectionHead"))
        f2 = QFormLayout()
        f2.setSpacing(12)
        self.model_boxes: dict[str, QComboBox] = {}
        self.model_keys: dict[str, str] = {}
        for 칸, 이름, 설정키, 도움말 in MODEL_ROWS:
            combo = QComboBox()
            combo.setEditable(False)
            지금 = self.db.get_setting(설정키, "") if self.db else ""
            combo.addItem(지금 or "아직 고르지 않았습니다", 지금)
            combo.currentIndexChanged.connect(
                lambda _=0, c=칸: self._save_model(c))
            self.model_boxes[칸] = combo
            self.model_keys[칸] = 설정키
            f2.addRow(field_label(이름, width=theme.FIELD_LABEL_W_WIDE), combo)
            f2.addRow(field_label("", width=theme.FIELD_LABEL_W_WIDE),
                      label(도움말, name="Hint"))
        l2.addLayout(f2)

        시험줄 = hbox()
        self.test_buttons: dict[str, QPushButton] = {}
        for 어디, 글 in (("openai", "대본·이미지 연결 확인"),
                        ("elevenlabs", "목소리 연결 확인"),
                        ("kling", "영상 연결 확인")):
            b = QPushButton(글)
            b.setObjectName("Secondary")
            b.clicked.connect(lambda _=False, w=어디: self._test(w))
            self.test_buttons[어디] = b
            시험줄.addWidget(b)
        시험줄.addStretch(1)
        l2.addLayout(시험줄)

        self.test_state = label("", name="Hint")
        l2.addWidget(self.test_state)
        l2.addWidget(label(
            "모델 이름은 프로그램 안에 박아두지 않습니다. [연결 확인] 을 누르면 "
            "지금 쓸 수 있는 것만 목록에 나옵니다.", name="Hint"))
        bl.addWidget(c2)

        # ── 기본 제작 필수 규칙 ──
        c5 = card()
        l5 = vbox(c5)
        if self.db is not None:
            from app.services.rules_service import ProductionRulesService
            self.rules_service = ProductionRulesService(self.db)
            self.rules_service.ensure_seeded()
        self.rules_panel = RulesPanel(self.rules_service)
        l5.addWidget(self.rules_panel)
        bl.addWidget(c5)

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

        # ── 자료가 쌓이는 곳 ──
        c6 = card()
        l6 = vbox(c6)
        l6.addWidget(label("만든 영상이 쌓이는 곳", name="SectionHead", wrap=False))
        자리 = Paths()
        l6.addWidget(label(f"내 문서 › {APP_DIR_NAME} › Projects", wrap=False))
        l6.addWidget(label(
            "탐색기에서 바로 찾을 수 있는 곳입니다. 숨김 폴더가 아닙니다.",
            name="Hint"))
        옛것 = 자리.legacy_data_root()
        if 옛것 is not None:
            # **옮기지도 지우지도 않습니다** (§0-1 4번). 어디 있는지만 알립니다.
            l6.addWidget(NoticeBox(
                f"예전 이름의 폴더가 그대로 있습니다: {옛것.name}\n"
                "안에 든 것은 건드리지 않았습니다. 필요하면 직접 옮겨 주세요.",
                tone="info", title="예전 폴더가 남아 있습니다"))
        bl.addWidget(c6)

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

    # ── 열쇠 넣고 지우기 ──────────────────────────────────
    def _has(self, key: str) -> bool:
        if self.vault is None:
            return False
        try:
            return self.vault.has(key)
        except Exception:
            return False

    def _refresh_key(self, key: str) -> None:
        self.key_states[key].setText(self._key_state_text(key))
        if btn := self.key_deletes.get(key):
            btn.setEnabled(self.vault is not None and self._has(key))

    def _delete_key(self, key: str) -> None:
        """저장해 둔 열쇠를 지웁니다. **금고 파일은 그대로 둡니다.**"""
        try:
            지웠나 = self.vault.delete(key)
        except Exception:
            self.key_states[key].setText("열쇠를 지우지 못했습니다. 회사에 문의해 주세요.")
            return
        self.key_states[key].setText(
            "지웠습니다. 다시 넣으셔야 씁니다." if 지웠나 else "지울 열쇠가 없습니다.")
        if btn := self.key_deletes.get(key):
            btn.setEnabled(False)

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
        self._refresh_key(key)

    # ── 모델 고르기와 연결 확인 ───────────────────────────
    #
    # **모델 이름을 추측해서 넣지 않습니다** (§0-2). [연결 확인] 이
    # 계정에 물어본 목록만 칸에 넣습니다. 못 물어보면 칸이 비어 있습니다.

    def _save_model(self, 칸: str) -> None:
        if self.db is None:
            return
        combo = self.model_boxes[칸]
        값 = combo.currentData()
        if 값 is None:
            값 = ""
        self.db.put_setting(self.model_keys[칸], str(값))

    def _fill_models(self, 칸: str, 목록: list[tuple[str, str]]) -> None:
        combo = self.model_boxes[칸]
        지금 = self.db.get_setting(self.model_keys[칸], "") if self.db else ""
        combo.blockSignals(True)
        combo.clear()
        combo.addItem("아직 고르지 않았습니다", "")
        for 값, 이름 in 목록:
            combo.addItem(이름, 값)
        고른자리 = combo.findData(지금)
        combo.setCurrentIndex(고른자리 if 고른자리 >= 0 else 0)
        combo.blockSignals(False)

    def _test(self, 어디: str) -> None:
        """[연결 확인]. 실패해도 **화면에는 한국어 한 줄만** 나옵니다 (§9)."""
        버튼 = self.test_buttons.get(어디)
        if 버튼 is not None:
            버튼.setEnabled(False)
        self.test_state.setText("확인하는 중입니다…")
        try:
            됐나, 말 = self._run_test(어디)
        except Exception:
            됐나, 말 = False, "확인하지 못했습니다. 잠시 뒤 다시 눌러 주세요."
        finally:
            if 버튼 is not None:
                버튼.setEnabled(True)
        self.test_state.setText(말)

    def _run_test(self, 어디: str) -> tuple[bool, str]:
        if self.registry is None:
            return False, "먼저 열쇠를 넣고 프로그램을 다시 켜 주세요."

        if 어디 == "openai":
            대본 = self.registry.script_provider()
            됐나, 말 = 대본.health()
            if 됐나:
                목록 = 대본.list_models()
                self._fill_models("script", 목록)
                self._fill_models("image", 목록)
            return 됐나, 말

        if 어디 == "elevenlabs":
            목소리 = self.registry.voice_provider()
            됐나, 말 = 목소리.health()
            if 됐나:
                self._fill_models("voice_model", 목소리.list_models())
                self._fill_models("voice_id", 목소리.list_voices())
            return 됐나, 말

        # 영상(Kling) 은 아직 붙이지 않았습니다. **가짜로 되는 척하지 않습니다.**
        from app.contracts.errors import ProviderError
        try:
            self.registry.video_provider()
        except ProviderError as e:
            return False, e.user_message
        return True, "영상 만들기를 쓸 수 있습니다."
