"""자막 만들기와 굽기 (지시서 §5 · §7).

ASS 로 만드는 이유는 스타일 제어가 쉽기 때문입니다 (§7).
글자 크기·위치·색·배경 띠를 ``assets/subtitle_style.json`` 에서 읽습니다.
담당자가 「글씨 더 크게」 라고 하면 그 파일만 고치면 됩니다. 다시 빌드하지 않습니다.

**광고 표시는 여기서 강제됩니다** (§5).
``build_cues()`` 가 ``disclosure`` 를 **키워드 필수 인자**로 받으므로
빼고 부르면 그 자리에서 오류가 납니다. 끄는 스위치는 없습니다.

ASS 색 표기가 헷갈립니다. ``&HAABBGGRR`` 로 **거꾸로**이고, 알파는
00 이 불투명, FF 가 완전 투명입니다. CSS 와 반대라 ``_ass_color()`` 에 모아 두었습니다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

from app.contracts.models import (
    SUBTITLE_MAX_CHARS_PER_LINE,
    SUBTITLE_MAX_LINES,
    VIDEO_HEIGHT,
    VIDEO_WIDTH,
    AdDisclosure,
    Scene,
    SubtitleCue,
)
from app.core.ffmpeg import Ffmpeg, FfmpegFailed

STYLE_BODY = "body"
STYLE_AD = "ad_disclosure"


# ─────────────────────────────────────────────────────────────
# ASS 값 만들기
# ─────────────────────────────────────────────────────────────


def _ass_color(hex_rgb: str, opacity: float = 1.0) -> str:
    """``#RRGGBB`` 를 ASS 의 ``&HAABBGGRR`` 로 바꿉니다.

    ASS 는 파랑·초록·빨강 순서이고 알파는 **00 이 불투명**입니다.
    CSS 와 정반대라 실수하기 쉬워서 한 곳에 모았습니다.
    """
    h = hex_rgb.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    a = round((1.0 - max(0.0, min(1.0, opacity))) * 255)
    return f"&H{a:02X}{b:02X}{g:02X}{r:02X}"


def _ass_time(seconds: float) -> str:
    """``0:00:03.50`` 꼴. ASS 는 1/100 초까지 씁니다."""
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _escape(text: str) -> str:
    """ASS 가 명령으로 오해할 글자를 막습니다.

    ``{`` ``}`` 는 스타일 명령 표시라 그대로 두면 자막이 사라집니다.
    """
    return (text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")
                .replace("\n", "\\N"))


def wrap_lines(text: str, *, max_chars: int = SUBTITLE_MAX_CHARS_PER_LINE,
               max_lines: int = SUBTITLE_MAX_LINES) -> tuple[str, ...]:
    """한 줄 16자 · 최대 2줄로 접습니다 (§7).

    담당자가 줄바꿈을 직접 넣었으면 그대로 씁니다.
    아니면 띄어쓰기에서 끊고, 그것도 안 되면 글자 수로 끊습니다.
    """
    직접 = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(직접) > 1:
        return tuple(직접[:max_lines])

    one = (직접[0] if 직접 else "").strip()
    if not one:
        return ()
    if len(one) <= max_chars:
        return (one,)

    줄: list[str] = []
    남은 = one
    while 남은 and len(줄) < max_lines:
        if len(남은) <= max_chars:
            줄.append(남은)
            break
        자를곳 = 남은.rfind(" ", 0, max_chars + 1)
        if 자를곳 <= 0:
            자를곳 = max_chars
        줄.append(남은[:자를곳].strip())
        남은 = 남은[자를곳:].strip()
    return tuple(줄)


def measure_text(lines: Sequence[str], *, font_size: int,
                 font_file: Optional[Path] = None) -> tuple[int, int]:
    """자막 덩어리가 화면에서 차지할 크기(가로, 세로)를 잽니다.

    배경 띠를 **글자에 맞춰 한 덩어리로** 그리기 위해 필요합니다.
    글꼴 파일이 있으면 실제로 재고, 없으면 어림합니다
    (한글 한 글자 ≈ 1em, 영문·숫자 ≈ 0.5em).
    """
    if not lines:
        return (0, 0)

    line_h = round(font_size * 1.32)      # libass 의 줄 간격에 가깝습니다

    if font_file and Path(font_file).is_file():
        try:
            from PIL import ImageFont

            f = ImageFont.truetype(str(font_file), font_size)
            w = max(round(f.getlength(ln)) for ln in lines)
            return (w, line_h * len(lines))
        except Exception:
            pass

    def 어림(ln: str) -> int:
        폭 = 0.0
        for ch in ln:
            폭 += 1.0 if ord(ch) > 0x2000 else 0.55
        return round(폭 * font_size)

    return (max(어림(ln) for ln in lines), line_h * len(lines))


# ─────────────────────────────────────────────────────────────
# 스타일 파일
# ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class StyleSpec:
    """``subtitle_style.json`` 의 스타일 하나."""

    name: str
    font_size: int
    bold: bool
    color: str
    outline_color: str
    outline: int
    shadow: int
    v_percent: float
    band: bool
    band_color: str
    band_opacity: float
    band_pad_x: int
    band_pad_y: int
    align: str = "가운데"

    @property
    def y_px(self) -> int:
        return round(VIDEO_HEIGHT * self.v_percent / 100)


class SubtitleStyle:
    """``assets/subtitle_style.json`` 을 읽습니다. **쓰지 않습니다.**"""

    def __init__(self, path: Path) -> None:
        self._path = Path(path)
        self._d: dict[str, Any] = json.loads(
            self._path.read_text(encoding="utf-8"))

    @property
    def path(self) -> Path:
        return self._path

    def safe_band(self) -> tuple[float, float]:
        z = self._d.get("세이프존", {}).get("본문자막_구간_퍼센트", [55, 75])
        return float(z[0]), float(z[1])

    def font_name(self) -> str:
        return self._d.get("폰트", {}).get("이름", "Noto Sans KR")

    def font_file(self) -> Optional[Path]:
        rel = self._d.get("폰트", {}).get("파일", "")
        if not rel:
            return None
        p = self._path.parent.parent / rel
        return p if p.is_file() else None

    def names(self) -> list[str]:
        return list(self._d.get("스타일", {}))

    def spec(self, name: str) -> StyleSpec:
        s = self._d.get("스타일", {}).get(name)
        if s is None:
            raise KeyError(f"자막 스타일 「{name}」 이 설정 파일에 없습니다")
        band = s.get("자막배경띠", {})
        return StyleSpec(
            name=name,
            font_size=int(s.get("글자크기", 64)),
            bold=str(s.get("굵기", "Bold")).lower() in ("bold", "black", "700", "800", "900"),
            color=s.get("색", "#FFFFFF"),
            outline_color=s.get("외곽선색", "#000000"),
            outline=int(s.get("외곽선두께", 4)),
            shadow=int(s.get("그림자", 2)),
            v_percent=float(s.get("세로위치_퍼센트", 64)),
            band=bool(band.get("사용", False)),
            band_color=band.get("색", "#000000"),
            band_opacity=float(band.get("불투명도", 0.45)),
            band_pad_x=int(band.get("좌우여백", 48)),
            band_pad_y=int(band.get("위아래여백", 18)),
            align=s.get("정렬", "가운데"),
        )

    def ad_placement(self) -> dict[str, Any]:
        return self._d.get("광고표시_넣는곳", {})


# ─────────────────────────────────────────────────────────────
# 자막 만들기
# ─────────────────────────────────────────────────────────────


class AssSubtitleBuilder:
    """``SubtitleBuilder`` 계약을 지킵니다 (``app/contracts/providers.py``)."""

    def __init__(self, style: SubtitleStyle, ffmpeg: Optional[Ffmpeg] = None) -> None:
        self.style = style
        self._ffmpeg = ffmpeg

    # ── 자막 목록 ─────────────────────────────────────────
    def build_cues(self, scenes: Sequence[Scene], *,
                   disclosure: AdDisclosure) -> list[SubtitleCue]:
        """본문 자막 + 광고 표시를 합쳐 돌려줍니다.

        ``disclosure`` 는 **키워드 필수**입니다. 빼고 부르면 오류가 납니다 (§5).
        """
        cues: list[SubtitleCue] = []

        for s in scenes:
            lines = wrap_lines(s.screen_text or "")
            if lines:
                cues.append(SubtitleCue(
                    start_sec=float(s.start_sec), end_sec=float(s.end_sec),
                    lines=lines, style=STYLE_BODY))

        if disclosure.required and scenes:
            cues.extend(self._ad_cues(scenes, disclosure))
        return cues

    def _ad_cues(self, scenes: Sequence[Scene],
                 disclosure: AdDisclosure) -> list[SubtitleCue]:
        """시작 · 중간 · 끝 세 번 (§5).

        공정위 추천보증 심사지침이 「시작과 끝에 넣고, 일부만 보는 사람도
        알아볼 수 있게 반복 표시」 를 요구합니다.
        """
        first, last = scenes[0], scenes[-1]
        total = float(last.end_sec)
        text = (disclosure.text,)

        중간시작 = max(0.0, total / 2 - disclosure.mid_hold_sec / 2)
        중간끝 = min(total, 중간시작 + disclosure.mid_hold_sec)

        return [
            SubtitleCue(float(first.start_sec), float(first.end_sec), text, STYLE_AD),
            SubtitleCue(중간시작, 중간끝, text, STYLE_AD),
            SubtitleCue(float(last.start_sec), float(last.end_sec), text, STYLE_AD),
        ]

    # ── ASS 파일 ──────────────────────────────────────────
    def write_ass(self, cues: Sequence[SubtitleCue], dest: Path) -> Path:
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(self.render_ass(cues), encoding="utf-8")
        return dest

    def render_ass(self, cues: Sequence[SubtitleCue]) -> str:
        font = self.style.font_name()
        쓰는스타일 = sorted({c.style for c in cues} | {STYLE_BODY})

        머리 = [
            "[Script Info]",
            "; 오락 숏폼 AI 스튜디오가 만들었습니다.",
            "ScriptType: v4.00+",
            "WrapStyle: 2",              # 우리가 접은 대로 둡니다. libass 가 다시 접지 않게.
            "ScaledBorderAndShadow: yes",
            f"PlayResX: {VIDEO_WIDTH}",
            f"PlayResY: {VIDEO_HEIGHT}",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour,"
            " OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut,"
            " ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,"
            " Alignment, MarginL, MarginR, MarginV, Encoding",
        ]
        for name in 쓰는스타일:
            머리.append(self._style_line(name, font))

        본문 = [
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR,"
            " MarginV, Effect, Text",
        ]
        # 층을 나눕니다. 띠가 맨 아래, 그 위에 글자, 광고 표시가 맨 위.
        #   0·1 본문 띠·글자    2·3 광고 표시 띠·글자
        font_file = self.style.font_file()
        for c in sorted(cues, key=lambda c: (c.start_sec, c.style)):
            base = 2 if c.style == STYLE_AD else 0
            spec = self.style.spec(c.style)
            cx, cy = VIDEO_WIDTH // 2, spec.y_px

            if spec.band:
                본문.append(self._band_line(c, spec, cx, cy, base, font_file))

            text = "\\N".join(_escape(ln) for ln in c.lines)
            본문.append(
                f"Dialogue: {base + 1},{_ass_time(c.start_sec)},{_ass_time(c.end_sec)},"
                f"{c.style},,0,0,0,,{{\\an5\\pos({cx},{cy})}}{text}")
        return "\n".join(머리 + 본문) + "\n"

    def _band_line(self, c: SubtitleCue, spec: StyleSpec, cx: int, cy: int,
                   layer: int, font_file: Optional[Path]) -> str:
        """반투명 배경 띠를 **직접 그립니다** (§7 · subtitle_style.json 의 자막배경띠).

        왜 직접 그리나 — ASS 의 「불투명 상자」 는 **줄마다 따로** 그려져서,
        두 줄 자막에서 상자가 계단처럼 어긋납니다. 여백을 키울수록 심해집니다.
        한 덩어리로 그려야 「띠」 가 됩니다.

        ``\\an7`` (왼쪽 위 기준) 로 두고 0,0 부터 그리면 위치가 정확합니다.
        """
        tw, th = measure_text(c.lines, font_size=spec.font_size, font_file=font_file)
        w = tw + spec.band_pad_x * 2
        h = th + spec.band_pad_y * 2
        x0, y0 = cx - w // 2, cy - h // 2

        색 = _ass_color(spec.band_color)
        투명도 = f"\\alpha&H{round((1 - spec.band_opacity) * 255):02X}&"
        모양 = f"m 0 0 l {w} 0 l {w} {h} l 0 {h}"
        return (
            f"Dialogue: {layer},{_ass_time(c.start_sec)},{_ass_time(c.end_sec)},"
            f"{c.style},,0,0,0,,"
            f"{{\\an7\\pos({x0},{y0})\\bord0\\shad0\\1c{색}{투명도}\\p1}}"
            f"{모양}{{\\p0}}"
        )

    def _style_line(self, name: str, font: str) -> str:
        s = self.style.spec(name)

        # 배경 띠는 BorderStyle 3(불투명 상자)으로 만듭니다.
        # 그때 상자 색은 OutlineColour 가 되고, Outline 값이 상자 여백이 됩니다.
        # 띠는 따로 그리므로(_band_line) 글자에는 외곽선과 그림자만 줍니다.
        # ASS 의 불투명 상자(BorderStyle 3)는 줄마다 따로 그려져 쓰지 않습니다.
        border_style = 1
        outline_colour = _ass_color(s.outline_color)
        outline = s.outline

        return (
            f"Style: {name},{font},{s.font_size},"
            f"{_ass_color(s.color)},{_ass_color(s.color)},"
            f"{outline_colour},{_ass_color('#000000', 0.6)},"
            f"{-1 if s.bold else 0},0,0,0,"
            f"100,100,0,0,"
            f"{border_style},{outline},{s.shadow},"
            f"5,60,60,60,1"          # \\an5 를 줄마다 다시 주므로 정렬은 5 로 둡니다
        )

    # ── 굽기 ──────────────────────────────────────────────
    def burn_in(self, video: Path, ass: Path, dest: Path, *,
                fonts_dir: Optional[Path] = None) -> Path:
        """영상에 자막을 구워 넣습니다 (§7 — burn-in).

        ``fonts_dir`` 로 동봉한 글꼴 폴더를 알려줍니다. 그래야 담당자 PC 에
        그 글꼴이 설치돼 있지 않아도 같은 모양으로 나옵니다.
        """
        ff = self._ffmpeg or Ffmpeg()
        video, ass, dest = Path(video), Path(ass), Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)

        # subtitles 필터 안에서는 : 와 \ 와 ' 가 구분자라 이스케이프가 필요합니다.
        # 경로를 통째로 넘기므로 공백은 문제없지만 이 세 글자는 반드시 처리합니다 (§3).
        f = str(ass).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
        chain = f"subtitles=filename='{f}'"
        if fonts_dir:
            d = str(fonts_dir).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
            chain += f":fontsdir='{d}'"

        ff.run(
            ["-y", "-i", str(video), "-vf", chain,
             "-c:v", "libx264", "-preset", "medium", "-crf", "20",
             "-pix_fmt", "yuv420p", "-c:a", "copy", str(dest)],
            user_message="자막을 넣지 못했습니다. 다시 시도해 주세요.")

        if not dest.is_file() or dest.stat().st_size == 0:
            raise FfmpegFailed(
                user_message="자막을 넣지 못했습니다. 다시 시도해 주세요.",
                log=f"output missing: {dest}", args=[])
        return dest
