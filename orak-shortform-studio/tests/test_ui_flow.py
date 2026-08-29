"""화면 시험 — Stage 2.

화면이 없는 컴퓨터에서도 Qt 를 offscreen 으로 띄워 **실제로 눌러봅니다.**

    python tests/test_ui_flow.py                  ← 눌러보기만
    python tests/test_ui_flow.py /어디/에/저장    ← 화면 사진까지 저장

사장님 PC(윈도우)에서는 그냥 실행하시면 진짜 창이 뜹니다:
    python -m app.main
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PySide6.QtWidgets import (  # noqa: E402
    QApplication,
    QCheckBox,
    QLabel,
    QPushButton,
    QWidget,
)

from app.ui.main_window import MENU, MainWindow  # noqa: E402
from app.ui.screens.new_video import NewVideoScreen  # noqa: E402

_app = QApplication.instance() or QApplication([])


def _window() -> MainWindow:
    w = MainWindow()
    w.show()
    return w


def _fill(screen) -> None:
    for k in ("store_name", "area", "address", "menu", "price", "features", "reason"):
        screen.fields[k].setText("값")


def _visible_texts(root: QWidget) -> list[str]:
    """화면에 실제로 글자로 나오는 것들을 모읍니다."""
    out: list[str] = []
    for kind in (QLabel, QPushButton, QCheckBox):
        for w in root.findChildren(kind):
            t = (w.text() or "").strip()
            if t:
                out.append(t)
    return out


# ─────────────────────────────────────────────────────────────
# 메뉴 (§9 — 딱 4개)
# ─────────────────────────────────────────────────────────────


def test_메뉴는_정확히_네개다() -> None:
    assert MENU == ["새 영상 만들기", "작업 목록", "캐릭터", "설정"]
    assert len(_window().menu_buttons) == 4


def test_메뉴를_누르면_화면이_넘어간다() -> None:
    """Stage 2 완료 기준입니다."""
    w = _window()
    for i, name in enumerate(MENU):
        w.menu_buttons[i].click()
        assert w.current_menu == name, f"{name} 을 눌렀는데 {w.current_menu} 이 떴습니다"
        assert w.menu_buttons[i].isChecked(), "누른 메뉴에 표시가 남아야 합니다"


# ─────────────────────────────────────────────────────────────
# 새 영상 만들기 흐름 (§9)
# ─────────────────────────────────────────────────────────────


def test_입력에서_완료까지_눌러서_갈_수_있다() -> None:
    w = _window()
    s: NewVideoScreen = w.screens["새 영상 만들기"]

    assert s.step == s.STEP_INPUT
    # Stage 4 에서 필수 칸 검사가 생겼습니다. 다 채워야 넘어갑니다.
    _fill(s)
    s.fields["store_name"].setText("할머니 손칼국수")
    s.fields["area"].setText("신림")

    s.make_script_button.click()
    _app.processEvents()
    assert s.step == s.STEP_SCRIPT, "AI 구성 만들기 → 대본 화면으로 넘어가야 합니다"

    s.produce_button.click()
    _app.processEvents()
    assert s.step == s.STEP_RUN, "영상 제작 → 진행 화면으로 넘어가야 합니다"

    s.go(s.STEP_DONE)
    assert s.step == s.STEP_DONE


def test_AI버튼은_두번_눌러도_한번만_동작한다() -> None:
    """§9 — 중복 클릭을 막으세요. 돈이 두 번 나가면 안 됩니다.

    필수 칸이 비어 있으면 버튼이 곧바로 풀리므로(돈이 안 나가니까),
    실제로 돈이 나갈 수 있는 상태 — 다 채운 상태 — 로 봅니다.
    """
    s = NewVideoScreen()
    _fill(s)
    눌린횟수 = []
    s.make_script_button.clicked.connect(lambda: 눌린횟수.append(1))

    s.make_script_button.click()
    assert s.make_script_button.is_busy, "누르는 즉시 잠겨야 합니다"
    assert not s.make_script_button.isEnabled()

    for _ in range(5):
        s.make_script_button.click()
    assert len(눌린횟수) == 1, f"{len(눌린횟수)}번 불렸습니다. 한 번이어야 합니다"

    s.make_script_button.finish()
    assert s.make_script_button.isEnabled()


def test_참고URL_안내가_화면에_붙어있다() -> None:
    """§4 — 이 안내는 고정으로 표시해야 합니다."""
    texts = " ".join(_visible_texts(NewVideoScreen()))
    assert "링크는 저장만 됩니다" in texts
    assert "프로그램이 대신 읽지 않습니다" in texts


def test_대가성을_켜면_안내가_뜬다() -> None:
    s = NewVideoScreen()
    assert not s.paid_notice.isVisible() or not s.paid_check.isChecked()
    s.paid_check.setChecked(True)
    assert s.paid_notice.isVisibleTo(s), "체크하면 안내가 보여야 합니다"
    안내 = " ".join(_visible_texts(s.paid_notice))
    assert "유료광고 포함" in 안내
    assert "끌 수 없습니다" in 안내


def test_참고URL을_추가할_수_있다() -> None:
    s = NewVideoScreen()
    s.url_input.setText("https://example.com/store")
    s._add_url()
    assert s.url_list.count() == 1
    assert s.url_input.text() == "", "추가한 뒤에는 입력칸이 비어야 합니다"


# ─────────────────────────────────────────────────────────────
# 대본 생성 연결 (Stage 4)
# ─────────────────────────────────────────────────────────────


def _fake_provider():
    """진짜 대본을 만든 것처럼 굴지만 API 는 부르지 않습니다."""
    import json
    from types import SimpleNamespace

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from test_script import GOOD, PRICING, FakeClient  # noqa: E402

    from app.providers.llm_claude import ClaudeScriptProvider

    return ClaudeScriptProvider(client=FakeClient(GOOD), pricing=PRICING)


def test_필수칸이_비면_알려주고_넘어가지_않는다() -> None:
    s = NewVideoScreen()
    s.make_script_button.click()
    _app.processEvents()
    assert s.step == s.STEP_INPUT, "빈 칸인데 넘어갔습니다"
    assert s.input_error.isVisibleTo(s)
    assert "매장명" in s.input_error.text()
    assert s.make_script_button.isEnabled(), "버튼이 잠긴 채로 남았습니다"


def test_열쇠가_있으면_진짜_대본이_뜬다() -> None:
    """Stage 4 완료 기준 — 입력하면 장면 5개가 화면에 나옵니다."""
    s = NewVideoScreen(script_provider=_fake_provider())
    _fill(s)
    s.make_script_button.click()
    _app.processEvents()

    assert s.step == s.STEP_SCRIPT
    assert s.script is not None
    assert len(s.script.scenes) == 5
    assert len(s.scene_editors) == 5, "장면마다 고칠 칸이 있어야 합니다"
    assert not s.sample_notice.isVisibleTo(s.stack.widget(s.STEP_SCRIPT)), \
        "진짜 대본인데 「예시입니다」 가 떠 있습니다"


def test_열쇠가_없으면_예시라고_말한다() -> None:
    s = NewVideoScreen()
    _fill(s)
    s.make_script_button.click()
    _app.processEvents()
    assert s.script is None
    texts = " ".join(_visible_texts(s.stack.widget(s.STEP_SCRIPT)))
    assert "예시입니다" in texts


def test_담당자가_고친_대본도_검사한다() -> None:
    """만들 때만 검사하고 사람이 고친 건 안 하면 구멍이 생깁니다."""
    s = NewVideoScreen(script_provider=_fake_provider())
    _fill(s)
    s.make_script_button.click()
    _app.processEvents()
    assert s.check_edits() == [], "처음엔 문제가 없어야 합니다"
    assert s.produce_button.isEnabled()

    idx, nar, txt = s.scene_editors[0]
    nar.setPlainText("가" * 60)              # 3초 장면에 60자
    _app.processEvents()

    problems = s.check_edits()
    assert problems, "고쳐서 규칙을 어겼는데 못 잡았습니다"
    assert not s.produce_button.isEnabled(), "규칙을 어겼는데 만들기가 눌립니다"
    assert s.rule_notice.isVisibleTo(s.stack.widget(s.STEP_SCRIPT))
    assert "너무 깁니다" in s.rule_notice.text()


def test_고친_것을_되돌리면_다시_만들_수_있다() -> None:
    s = NewVideoScreen(script_provider=_fake_provider())
    _fill(s)
    s.make_script_button.click()
    _app.processEvents()
    idx, nar, txt = s.scene_editors[0]
    원래 = nar.toPlainText()
    nar.setPlainText("가" * 60)
    assert not s.produce_button.isEnabled()
    nar.setPlainText(원래)
    _app.processEvents()
    assert s.produce_button.isEnabled(), "되돌렸는데 여전히 잠겨 있습니다"


def test_과장표현을_넣으면_막는다() -> None:
    s = NewVideoScreen(script_provider=_fake_provider())
    _fill(s)
    s.make_script_button.click()
    _app.processEvents()
    idx, nar, txt = s.scene_editors[0]
    nar.setPlainText("여기가 신림 최고입니다")
    _app.processEvents()
    assert not s.produce_button.isEnabled()
    assert "최고" in s.rule_notice.text()


def test_대본_실패는_한국어로_알린다() -> None:
    """§9 — 개발자 오류를 담당자에게 보여주지 않습니다."""
    from app.contracts.errors import ProviderError, Retry

    class 실패하는공급자:
        def generate(self, store):
            raise ProviderError(
                retry=Retry.NEVER_AUTH,
                user_message="사용 키에 문제가 있습니다. 회사에 문의해 주세요.",
                log_detail="401 x-api-key invalid", provider="claude",
                vendor_code="401")

        def estimate(self, store, n):
            from app.contracts.models import CostEstimate
            return CostEstimate(krw=0, is_complete=False)

    s = NewVideoScreen(script_provider=실패하는공급자())
    _fill(s)
    s.make_script_button.click()
    _app.processEvents()

    assert s.step == s.STEP_INPUT, "실패했는데 다음 화면으로 넘어갔습니다"
    assert "회사에 문의해 주세요" in s.input_error.text()
    assert "401" not in s.input_error.text()
    assert "x-api-key" not in s.input_error.text()
    assert s.make_script_button.isEnabled(), "다시 누를 수 있어야 합니다"


def test_참고주소는_저장만_되고_열리지_않는다() -> None:
    """§0-4 — 프로그램이 대신 읽지 않습니다."""
    s = NewVideoScreen()
    s.url_input.setText("https://example.com/store")
    s._add_url()
    _fill(s)
    store = s.store_info()
    assert len(store.reference_urls) == 1
    assert store.reference_urls[0].url == "https://example.com/store"
    금지 = {"fetch", "open", "read", "download"}
    assert not (set(dir(store.reference_urls[0])) & 금지)


# ─────────────────────────────────────────────────────────────
# 비용 표시줄 (§11 — 항상 보임)
# ─────────────────────────────────────────────────────────────


def test_비용표시줄이_항상_보인다() -> None:
    w = _window()
    for i in range(len(MENU)):
        w.menu_buttons[i].click()
        assert w.cost_bar.isVisibleTo(w), f"{MENU[i]} 에서 비용 표시줄이 사라졌습니다"


def test_하단_문구가_낡지_않았는지_본다() -> None:
    """단계가 올라갔는데 「Stage 2」 같은 옛 문구가 남으면 안 됩니다."""
    bar = _window().cost_bar
    문구 = bar._stage.text()
    assert "Stage 2" not in 문구, f"낡은 문구가 남아 있습니다: {문구!r}"
    bar.set_stage_note("바꿔봄")
    assert bar._stage.text() == "바꿔봄"


def test_한도를_넘으면_문구가_바뀐다() -> None:
    bar = _window().cost_bar
    bar.set_usage(21000, 50000)
    assert "21,000원 / 50,000원" in bar._text.text()
    assert bar._note.text() == "", "42% 에서는 경고가 없어야 합니다"

    bar.set_usage(42000, 50000)
    assert "80%" in bar._note.text(), "80% 를 넘으면 경고해야 합니다"

    bar.set_usage(51000, 50000)
    assert "한도에 도달했습니다" in bar._note.text()
    assert "회사에 문의해 주세요" in bar._note.text()


# ─────────────────────────────────────────────────────────────
# 화면에 개발자 말이 새지 않는가 (§9)
# ─────────────────────────────────────────────────────────────

금지패턴 = [
    (r"\bTraceback\b", "파이썬 오류 흔적"),
    (r"\b(Exception|TypeError|ValueError|KeyError|RuntimeError)\b", "파이썬 예외 이름"),
    (r"\bstack trace\b", "오류 추적"),
    (r"\bHTTP\b", "HTTP"),
    # 공급자 오류코드는 실제 문서에 있는 값만 봅니다.
    # 1080(해상도)·1920 같은 숫자를 오류로 잘못 잡지 않기 위해서입니다.
    (r"\b(100[0-4]|110[1-4]|120[0-3]|130[1-4]|500[0-2])\b", "공급자 오류코드"),
    # 상태코드는 「오류·실패·코드」 같은 말 옆에 있을 때만 잡습니다.
    (r"(오류|에러|실패|코드|상태)\s*:?\s*\d{3}\b", "오류 옆 상태코드"),
    (r'\{\s*"', "JSON 원문"),
    (r"\bNone\b|\bnull\b|\bundefined\b", "빈 값 표기"),
]


def test_화면에_개발자_말이_없다() -> None:
    w = _window()
    문제: list[str] = []
    for i in range(len(MENU)):
        w.menu_buttons[i].click()
        for text in _visible_texts(w.stack.currentWidget()):
            for pat, 뭔지 in 금지패턴:
                if re.search(pat, text):
                    문제.append(f"[{MENU[i]}] {뭔지}: {text!r}")
    assert not 문제, "담당자 화면에 개발자 말이 있습니다:\n  " + "\n  ".join(문제)


def test_새영상_모든_단계에도_개발자_말이_없다() -> None:
    s = NewVideoScreen()
    문제: list[str] = []
    for step in range(4):
        s.go(step)
        for text in _visible_texts(s.stack.currentWidget()):
            for pat, 뭔지 in 금지패턴:
                if re.search(pat, text):
                    문제.append(f"[{step}단계] {뭔지}: {text!r}")
    assert not 문제, "\n  " + "\n  ".join(문제)


# ─────────────────────────────────────────────────────────────
# 글자가 잘리지 않는가
# ─────────────────────────────────────────────────────────────


def test_입력칸_이름이_잘리지_않는다() -> None:
    """이름칸 너비를 고정했으므로, 이름이 길면 글자가 잘립니다.

    사장님 화면에서 「대본 만들기 (Claude」 처럼 끊겨 보이면 안 됩니다.
    """
    w = _window()
    잘린것: list[str] = []
    for i in range(len(MENU)):
        w.menu_buttons[i].click()
        for lb in w.stack.currentWidget().findChildren(QLabel):
            if lb.objectName() != "FieldLabel" or not lb.text().strip():
                continue
            필요 = lb.sizeHint().width()
            있는것 = lb.width() or lb.minimumWidth()
            if 필요 > 있는것:
                잘린것.append(f"[{MENU[i]}] {lb.text()!r} — {필요}px 필요한데 {있는것}px")
    assert not 잘린것, "글자가 잘립니다:\n  " + "\n  ".join(잘린것)


# ─────────────────────────────────────────────────────────────
# 캐릭터·설정 화면
# ─────────────────────────────────────────────────────────────


def test_캐릭터화면이_없는_기준이미지를_알려준다() -> None:
    w = _window()
    화면 = w.screens["캐릭터"]
    texts = " ".join(_visible_texts(화면))
    if 화면.missing_masters:
        assert "기준 이미지가 아직 없습니다" in texts
        assert "01_주마스터_놀람.png" in texts


def test_캐릭터화면이_색을_제대로_보여준다() -> None:
    """색 칸이 채워졌으면 그 값을, 비었으면 비었다고 알려줘야 합니다.

    설정 파일의 자리표시자(``__사장님_확인_필요__``)를 **그대로 화면에 띄우면 안 됩니다.**
    담당자에게는 개발자 표기가 아니라 사람 말이 보여야 합니다 (§9).
    """
    import json
    from pathlib import Path

    from app.ui.screens.character import PLACEHOLDER, PROFILE_PATH

    colors = json.loads(Path(PROFILE_PATH).read_text(encoding="utf-8"))["고정"]["대표색상"]
    적힌것 = {k: v for k, v in colors.items() if v != PLACEHOLDER}
    빈것 = [k for k, v in colors.items() if v == PLACEHOLDER]

    texts = " ".join(_visible_texts(_window().screens["캐릭터"]))

    assert PLACEHOLDER not in texts, "설정 파일 자리표시자를 그대로 띄우면 안 됩니다"

    for key, value in 적힌것.items():
        assert value in texts, f"{key} 에 적힌 색이 화면에 안 보입니다: {value!r}"

    if 빈것:
        assert "아직 안 적으셨습니다" in texts, "비어 있는 칸은 비었다고 알려줘야 합니다"
        assert "채워주셔야 합니다" in texts, "무엇을 해야 하는지 안내해야 합니다"
    else:
        assert "아직 안 적으셨습니다" not in texts, \
            "다 채웠는데도 비었다고 나옵니다"
        assert "채워주셔야 합니다" not in texts, \
            "다 채웠는데도 채우라는 안내가 남아 있습니다"


def test_열쇠칸은_금고를_열_수_있을_때만_열린다() -> None:
    """Stage 3 에서 금고를 붙였습니다.

    윈도우면 칸이 열리고, 아니면 잠긴 채로 **왜 안 되는지 알려줘야** 합니다.
    안전한 척하며 평문으로 받아두는 길은 없습니다.
    """
    s = _window().screens["설정"]
    assert len(s.key_inputs) == 4

    열림 = [w.isEnabled() for w in s.key_inputs.values()]
    assert len(set(열림)) == 1, "일부만 열리면 안 됩니다"

    if s.vault is None:
        assert not any(열림), "금고가 없는데 칸이 열렸습니다"
        assert s.vault_error, "왜 안 되는지 알려줘야 합니다"
        assert "윈도우" in s.vault_error
    else:
        assert all(열림), "금고가 있는데 칸이 잠겼습니다"


def test_열쇠를_넣으면_가려진_형태로만_보인다() -> None:
    """§10-3 — 화면에는 sk-...★★★★ 만. 입력칸은 곧바로 비웁니다."""
    import tempfile
    from pathlib import Path

    from app.core.secrets import CredentialStore, InsecureTestCipher
    from app.ui.screens.settings import SettingsScreen

    비밀 = "sk-ant-api03-SCREEN-TEST-abcdefghij"
    금고 = CredentialStore(Path(tempfile.mkdtemp()) / "c.dat", InsecureTestCipher())
    화면 = SettingsScreen(vault=금고)

    화면.key_inputs["claude"].setText(비밀)
    화면._save_key("claude")

    assert 화면.key_inputs["claude"].text() == "", "입력칸에 원문이 남아 있습니다"
    보이는것 = " ".join(_visible_texts(화면))
    assert 비밀 not in 보이는것, "화면에 원문이 보입니다"
    assert "sk-...★★★★" in 보이는것, "가려진 형태가 안 보입니다"


def test_설정에_배경음악_저작권_안내가_있다() -> None:
    texts = " ".join(_visible_texts(_window().screens["설정"]))
    assert "상업적 이용이 가능한 음원만" in texts


# ─────────────────────────────────────────────────────────────
# 화면 사진 저장
# ─────────────────────────────────────────────────────────────


def capture(outdir: Path) -> list[Path]:
    outdir.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    w = _window()
    w.resize(1120, 760)

    plan = [
        (0, None, "1_새영상_입력"),
        (0, 1, "2_새영상_대본"),
        (0, 2, "3_새영상_진행"),
        (0, 3, "4_새영상_완료"),
        (1, None, "5_작업목록"),
        (2, None, "6_캐릭터"),
        (3, None, "7_설정"),
    ]
    for menu_idx, sub, name in plan:
        w.menu_buttons[menu_idx].click()
        if sub is not None:
            w.screens["새 영상 만들기"].go(sub)
        if name == "3_새영상_진행":
            w.screens["새 영상 만들기"].set_progress(2, "영상을 만들고 있습니다. 2~3분 걸립니다.")
        if name.startswith(("5_", "6_", "7_")):
            w.cost_bar.set_usage(21000, 50000)
        _app.processEvents()
        path = outdir / f"{name}.png"
        w.grab().save(str(path))
        saved.append(path)
    return saved


if __name__ == "__main__":
    import traceback

    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    통과 = 실패 = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  통과   {name}")
            통과 += 1
        except Exception:
            print(f"  실패 ✗ {name}")
            traceback.print_exc()
            실패 += 1
    print(f"\n{통과}개 통과, {실패}개 실패 (전체 {len(tests)}개)")

    if len(sys.argv) > 1:
        paths = capture(Path(sys.argv[1]))
        print(f"\n화면 사진 {len(paths)}장 저장:")
        for p in paths:
            print("   ", p)
    sys.exit(1 if 실패 else 0)
