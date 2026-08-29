"""자막 시험 — Stage 8.

완료 기준: **체크박스 켜면 시작·중간·끝에 유료광고 표시가 들어감.**
가짜가 아니라 **진짜 FFmpeg 로 구워서** 확인합니다.

    python tests/test_subtitles.py
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.contracts.models import (  # noqa: E402
    SUBTITLE_MAX_CHARS_PER_LINE,
    VIDEO_HEIGHT,
    VIDEO_WIDTH,
    AdDisclosure,
    RenderMode,
    Scene,
    SubtitleCue,
)
from app.contracts.providers import SubtitleBuilder  # noqa: E402
from app.core.ffmpeg import Ffmpeg  # noqa: E402
from app.media.subtitles import (  # noqa: E402
    STYLE_AD,
    STYLE_BODY,
    AssSubtitleBuilder,
    SubtitleStyle,
    _ass_color,
    _ass_time,
    _escape,
    measure_text,
    wrap_lines,
)

ROOT = Path(__file__).resolve().parent.parent
STYLE_PATH = ROOT / "assets" / "subtitle_style.json"

_ff: Ffmpeg | None = None


def ff() -> Ffmpeg:
    global _ff
    if _ff is None:
        _ff = Ffmpeg()
    return _ff


def _scenes() -> list[Scene]:
    return [
        Scene(idx=1, start_sec=0, end_sec=3, render_mode=RenderMode.KLING,
              screen_text="6천 원?"),
        Scene(idx=2, start_sec=3, end_sec=7, render_mode=RenderMode.KENBURNS,
              screen_text="신림동 골목"),
        Scene(idx=3, start_sec=7, end_sec=12, render_mode=RenderMode.KENBURNS,
              screen_text="멸치로 국물을 낸 손칼국수집입니다"),
        Scene(idx=4, start_sec=12, end_sec=17, render_mode=RenderMode.KLING,
              screen_text="국물이 깊다"),
        Scene(idx=5, start_sec=17, end_sec=23, render_mode=RenderMode.KENBURNS,
              screen_text="6,000원 · 도보 5분"),
    ]


def _builder(font_file: str | None = None) -> AssSubtitleBuilder:
    """설정 파일 사본을 씁니다. **원본은 건드리지 않습니다.**"""
    d = json.loads(STYLE_PATH.read_text(encoding="utf-8"))
    if font_file:
        d["폰트"]["파일"] = font_file
    p = Path(tempfile.mkdtemp()) / "subtitle_style.json"
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    return AssSubtitleBuilder(SubtitleStyle(p), ffmpeg=ff())


def _system_font() -> Path | None:
    for p in (Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
              Path("C:/Windows/Fonts/malgun.ttf")):
        if p.is_file():
            return p
    return None


# ═════════════════════════════════════════════════════════════
# 광고 표시 (§5) — Stage 8 완료 기준
# ═════════════════════════════════════════════════════════════


def test_대가성이면_시작_중간_끝에_들어간다() -> None:
    """**Stage 8 완료 기준입니다.**"""
    scenes = _scenes()
    cues = _builder().build_cues(scenes, disclosure=AdDisclosure(is_paid=True))
    광고 = sorted((c for c in cues if c.style == STYLE_AD),
                  key=lambda c: c.start_sec)

    assert len(광고) == 3, f"{len(광고)}번 나옵니다. 시작·중간·끝 세 번이어야 합니다"
    시작, 중간, 끝 = 광고
    assert 시작.start_sec == 0 and 시작.end_sec == scenes[0].end_sec, "첫 장면 전체"
    assert 끝.start_sec == scenes[-1].start_sec and 끝.end_sec == scenes[-1].end_sec, "마지막 장면 전체"
    총 = scenes[-1].end_sec
    assert abs((중간.start_sec + 중간.end_sec) / 2 - 총 / 2) < 0.6, "대략 절반 지점"
    assert abs((중간.end_sec - 중간.start_sec) - 2.0) < 0.1, "2초 동안"
    assert all(c.lines == ("유료광고 포함",) for c in 광고)


def test_대가성이_아니면_안_들어간다() -> None:
    cues = _builder().build_cues(_scenes(), disclosure=AdDisclosure(is_paid=False))
    assert not [c for c in cues if c.style == STYLE_AD]


def test_광고표시_인자를_빼면_오류가_난다() -> None:
    """§5 — 담당자도 코드도 끌 수 없습니다."""
    try:
        _builder().build_cues(_scenes())      # type: ignore[call-arg]
    except TypeError:
        pass
    else:  # pragma: no cover
        raise AssertionError("광고 표시 없이 자막이 만들어졌습니다")


def test_광고표시가_본문과_다른_스타일이다() -> None:
    """§5 — 본문과 구분되는 스타일이어야 합니다. 안 그러면 표시 안 한 것과 같습니다."""
    b = _builder()
    본문 = b.style.spec(STYLE_BODY)
    광고 = b.style.spec(STYLE_AD)
    assert 광고.v_percent != 본문.v_percent, "위치가 같으면 구분이 안 됩니다"
    assert 광고.band, "광고 표시에는 배경 박스가 있어야 합니다"
    assert 광고.band_opacity > 본문.band_opacity, "광고 표시가 더 진해야 합니다"


def test_광고표시가_본문_위에_그려진다() -> None:
    b = _builder()
    ass = b.render_ass(b.build_cues(_scenes(), disclosure=AdDisclosure(is_paid=True)))
    층 = {}
    for line in ass.splitlines():
        if line.startswith("Dialogue:"):
            부분 = line.split(",")
            층.setdefault(부분[3], set()).add(int(부분[0].split(":")[1]))
    assert min(층[STYLE_AD]) > max(층[STYLE_BODY]), "광고 표시가 본문에 가리면 안 됩니다"


# ═════════════════════════════════════════════════════════════
# 자막 규칙 (§7)
# ═════════════════════════════════════════════════════════════


def test_한줄_16자로_접는다() -> None:
    for t in ["멸치로 국물을 낸 손칼국수집입니다 신림 골목 안쪽",
              "가나다라마바사아자차카타파하가나다라마바사"]:
        for ln in wrap_lines(t):
            assert len(ln) <= SUBTITLE_MAX_CHARS_PER_LINE, f"{len(ln)}자: {ln}"


def test_최대_두줄이다() -> None:
    긴글 = "가나다라마바사아자차카타파하" * 5
    assert len(wrap_lines(긴글)) <= 2


def test_담당자가_넣은_줄바꿈을_지킨다() -> None:
    assert wrap_lines("6,000원\n도보 5분") == ("6,000원", "도보 5분")


def test_자막이_세이프존_안에_있다() -> None:
    """릴스·쇼츠는 위 14% · 아래 20% 를 앱 UI 가 가립니다 (§7)."""
    b = _builder()
    lo, hi = b.style.safe_band()
    본문 = b.style.spec(STYLE_BODY)
    assert lo <= 본문.v_percent <= hi, f"본문이 {본문.v_percent}% 입니다"
    광고 = b.style.spec(STYLE_AD)
    assert 14 < 광고.v_percent < 80, f"광고 표시가 {광고.v_percent}% — 앱 UI 에 가립니다"


def test_글자가_충분히_크다() -> None:
    """§7 — 1080x1920 기준 최소 64px."""
    assert _builder().style.spec(STYLE_BODY).font_size >= 64


def test_재배포_가능한_글꼴만_쓴다() -> None:
    """§7 — 맑은 고딕은 재배포 라이선스가 없습니다."""
    이름 = _builder().style.font_name().lower()
    assert "malgun" not in 이름 and "맑은" not in 이름, 이름


# ═════════════════════════════════════════════════════════════
# ASS 만들기
# ═════════════════════════════════════════════════════════════


def test_계약을_지킨다() -> None:
    assert isinstance(_builder(), SubtitleBuilder)


def test_색을_ASS_방식으로_바꾼다() -> None:
    """ASS 는 BGR 순서이고 알파는 00 이 불투명입니다. CSS 와 반대라 자주 틀립니다."""
    assert _ass_color("#FFFFFF") == "&H00FFFFFF"
    assert _ass_color("#FF0000") == "&H000000FF", "빨강이 BGR 로는 0000FF"
    assert _ass_color("#0000FF") == "&H00FF0000", "파랑이 BGR 로는 FF0000"
    assert _ass_color("#000000", 0.0) == "&HFF000000", "0.0 이면 완전 투명"
    assert _ass_color("#000000", 1.0) == "&H00000000", "1.0 이면 불투명"


def test_시간을_ASS_방식으로_쓴다() -> None:
    assert _ass_time(0) == "0:00:00.00"
    assert _ass_time(3.5) == "0:00:03.50"
    assert _ass_time(83.25) == "0:01:23.25"


def test_중괄호를_막는다() -> None:
    """``{`` 를 그대로 두면 ASS 가 명령으로 읽어 자막이 사라집니다."""
    나온것 = _escape("{이건 명령이 아니라 글자}")
    assert "{" not in 나온것 and "}" not in 나온것


def test_화면크기가_들어간다() -> None:
    b = _builder()
    ass = b.render_ass(b.build_cues(_scenes(), disclosure=AdDisclosure(is_paid=False)))
    assert f"PlayResX: {VIDEO_WIDTH}" in ass
    assert f"PlayResY: {VIDEO_HEIGHT}" in ass


def test_띠를_한_덩어리로_그린다() -> None:
    """ASS 의 불투명 상자는 **줄마다 따로** 그려져 두 줄이면 계단처럼 어긋납니다.

    그래서 직접 그립니다. 스타일 줄에 BorderStyle 3 이 있으면 안 됩니다.
    """
    b = _builder()
    ass = b.render_ass(b.build_cues(_scenes(), disclosure=AdDisclosure(is_paid=True)))

    for line in ass.splitlines():
        if line.startswith("Style:"):
            부분 = line.split(",")
            assert 부분[16].strip() != "3", f"불투명 상자를 쓰고 있습니다: {line[:40]}"

    그림 = [l for l in ass.splitlines() if "\\p1}" in l]
    본문수 = sum(1 for c in b.build_cues(_scenes(), disclosure=AdDisclosure(is_paid=True)))
    assert len(그림) == 본문수, "자막마다 띠가 하나씩 있어야 합니다"
    for l in 그림:
        assert re.search(r"m 0 0 l \d+ 0 l \d+ \d+ l 0 \d+", l), "네모 하나여야 합니다"


def test_글자_크기를_잰다() -> None:
    w1, h1 = measure_text(["가나다"], font_size=72)
    w2, h2 = measure_text(["가나다라마바"], font_size=72)
    assert w2 > w1, "글자가 많으면 넓어야 합니다"
    assert measure_text(["가"], font_size=72)[1] < measure_text(["가", "나"], font_size=72)[1]
    assert measure_text([], font_size=72) == (0, 0)


def test_글꼴파일로_더_정확히_잰다() -> None:
    f = _system_font()
    if f is None:  # pragma: no cover
        return
    어림 = measure_text(["멸치로 국물을 낸"], font_size=72)[0]
    실측 = measure_text(["멸치로 국물을 낸"], font_size=72, font_file=f)[0]
    assert 실측 > 0 and abs(실측 - 어림) < 어림, "너무 동떨어지면 어림이 잘못된 것입니다"


# ═════════════════════════════════════════════════════════════
# 실제로 구워지는가
# ═════════════════════════════════════════════════════════════


def _bg_video(out: Path, seconds: int = 23) -> Path:
    from PIL import Image, ImageDraw

    from app.contracts.models import VideoRequest
    from app.providers.video_kenburns import KenBurnsProvider

    img = Image.new("RGB", (1080, 1920), (243, 222, 198))
    d = ImageDraw.Draw(img)
    d.ellipse([180, 240, 900, 1180], fill=(239, 227, 200))
    d.rectangle([260, 1150, 820, 1500], fill=(107, 74, 47))
    photo = out / "bg.jpg"
    img.save(photo, quality=90)

    kb = KenBurnsProvider(ffmpeg=ff())
    req = VideoRequest(scene_idx=1, request_sec=seconds, prompt="",
                       source_photo=photo, external_task_id="bg")
    kb.submit(req)
    return kb.render(req, out / "bg.mp4")


def test_자막이_실제로_구워진다() -> None:
    out = Path(tempfile.mkdtemp())
    font = _system_font()
    b = _builder(font_file=f"../..{font}" if font else None)
    if font:
        b.style._d["폰트"]["이름"] = "WenQuanYi Zen Hei"

    bg = _bg_video(out, seconds=5)
    ass = b.write_ass(
        b.build_cues(_scenes()[:2], disclosure=AdDisclosure(is_paid=True)),
        out / "s.ass")
    made = b.burn_in(bg, ass, out / "burned.mp4",
                     fonts_dir=font.parent if font else None)

    info = ff().probe(made)
    assert (info.width, info.height) == (VIDEO_WIDTH, VIDEO_HEIGHT)
    assert made.stat().st_size > 5_000


def test_구운_뒤_화면에_글자가_보인다() -> None:
    """구웠다고 파일만 커지면 소용없습니다. 픽셀이 달라졌는지 봅니다."""
    from PIL import Image

    out = Path(tempfile.mkdtemp())
    font = _system_font()
    b = _builder()
    if font:
        b.style._d["폰트"]["이름"] = "WenQuanYi Zen Hei"

    bg = _bg_video(out, seconds=3)
    ass = b.write_ass(
        b.build_cues(_scenes()[:1], disclosure=AdDisclosure(is_paid=True)),
        out / "s.ass")
    burned = b.burn_in(bg, ass, out / "b.mp4",
                       fonts_dir=font.parent if font else None)

    frames = []
    for name, src in (("before", bg), ("after", burned)):
        p = out / f"{name}.png"
        ff().run(["-y", "-ss", "1.5", "-i", str(src), "-frames:v", "1", str(p)])
        frames.append(Image.open(p).convert("RGB"))

    다름 = sum(1 for a, b_ in zip(list(frames[0].getdata()),
                                  list(frames[1].getdata())) if a != b_)
    비율 = 다름 / (VIDEO_WIDTH * VIDEO_HEIGHT) * 100
    assert 비율 > 1.5, f"{비율:.2f}% 만 달라졌습니다. 자막이 안 나온 것 같습니다"


def test_설정_원본을_건드리지_않는다() -> None:
    """시험이 사장님 설정 파일을 고치면 안 됩니다."""
    before = STYLE_PATH.read_bytes()
    b = _builder()
    b.build_cues(_scenes(), disclosure=AdDisclosure(is_paid=True))
    assert STYLE_PATH.read_bytes() == before


def test_없는_스타일을_부르면_한국어로_알려준다() -> None:
    try:
        _builder().style.spec("이런스타일없음")
    except KeyError as e:
        assert "설정 파일에 없습니다" in str(e)
    else:  # pragma: no cover
        raise AssertionError("없는 스타일이 통과했습니다")


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
    sys.exit(1 if 실패 else 0)
