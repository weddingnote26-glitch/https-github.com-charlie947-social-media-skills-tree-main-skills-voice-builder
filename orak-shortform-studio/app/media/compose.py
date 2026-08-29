"""최종 합성 (지시서 §8).

    해상도 1080x1920 · H.264(libx264) · yuv420p · 30fps
    소리   AAC 128k · 44.1kHz
    길이   30초 절대 초과 금지

§8 이 정한 순서: **장면 이어붙이기 → 음성 → BGM → 자막 굽기.**

**한 번에 처리합니다.** 단계마다 따로 인코딩하면 그때마다 화질이 떨어지는데,
인스타그램이 올릴 때 또 한 번 다시 만듭니다. 두 번 손해 볼 이유가 없습니다.
대신 필터를 이름 붙인 조각으로 나눠 두어 어디가 잘못됐는지 볼 수 있게 했습니다.

**길이 검사를 먼저 합니다.** 30초를 넘으면 합성을 시작하지 않고,
어느 장면을 줄여야 하는지 알려줍니다. **자동으로 잘라내지 않습니다** (§8).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

from app.contracts.errors import PlanRejected
from app.contracts.models import (
    MAX_TOTAL_SEC,
    VIDEO_FPS,
    VIDEO_HEIGHT,
    VIDEO_WIDTH,
    Scene,
)
from app.core.ffmpeg import Ffmpeg, FfmpegFailed

AUDIO_RATE = 44100
AUDIO_BITRATE = "128k"

VOICE_TARGET_LUFS = -16.0
"""말소리를 이 크기로 맞춥니다. 짧은 세로 영상에서 널리 쓰는 값입니다.

**장면마다 따로 맞춥니다.** 성우 목소리든 AI 음성이든 파일마다 크기가
들쭉날쭉한데, 그대로 두면 어떤 장면은 안 들리고 어떤 장면은 시끄럽습니다.
"""

BGM_GAIN_DB = -18.0
"""BGM 은 **말소리보다** 18dB 작아야 합니다 (§8).

파일을 18dB 줄이는 게 아닙니다. 넣는 음원마다 원래 크기가 다르기 때문에,
그냥 줄이면 조용한 mp3 는 안 들리고 시끄러운 mp3 는 말소리를 덮습니다.
**먼저 재고**, 말소리 기준보다 18dB 아래로 **맞춥니다.**
"""

GAIN_LIMIT_DB = 24.0
"""아무리 조용한 파일이라도 이 이상은 올리지 않습니다. 잡음까지 커집니다."""

SILENCE_LUFS = -70.0
"""이보다 조용하면 무음으로 봅니다. 무음을 억지로 키우면 잡음만 커집니다."""

BGM_FADE_SEC = 1.5
BGM_FORMATS = (".mp3", ".m4a", ".wav", ".aac", ".ogg")


@dataclass(frozen=True)
class Cut:
    """완성본에 들어갈 한 토막.

    ``use_sec`` 이 ``source`` 보다 짧을 수 있습니다 — Kling 은 5초만 만드는데
    Scene 1 은 3초만 쓰기 때문입니다 (§2-1). 앞에서부터 잘라 씁니다.
    """

    source: Path
    use_sec: float
    voice: Optional[Path] = None
    """이 토막에 깔 말소리. 없으면 그만큼 조용합니다 (Stage 7 전)."""

    scene_idx: int = 0


def cuts_from_scenes(scenes: Sequence[Scene]) -> list[Cut]:
    """Scene 목록을 토막으로 바꿉니다. 영상이 없는 장면은 빠집니다."""
    out: list[Cut] = []
    for s in scenes:
        if not s.video_path:
            continue
        out.append(Cut(source=Path(s.video_path), use_sec=float(s.use_sec),
                       voice=Path(s.audio_path) if s.audio_path else None,
                       scene_idx=s.idx))
    return out


def find_bgm(bgm_dir: Path) -> Optional[Path]:
    """``assets/bgm/`` 에서 음원을 찾습니다.

    **동봉하지 않습니다** (§8). 담당자가 상업적 이용이 가능한 음원을 직접 넣습니다.
    비어 있으면 배경음악 없이 만듭니다 — 음성과 자막은 그대로 나옵니다.
    """
    d = Path(bgm_dir)
    if not d.is_dir():
        return None
    for p in sorted(d.iterdir()):
        if p.is_file() and p.suffix.lower() in BGM_FORMATS:
            return p
    return None


# ─────────────────────────────────────────────────────────────
# 소리 크기 재기 (§8 — 「말소리 대비 -18dB」 를 진짜로 지키려면)
# ─────────────────────────────────────────────────────────────


def measure_lufs(path: Path, ffmpeg: Ffmpeg) -> Optional[float]:
    """소리가 실제로 얼마나 큰지 잽니다 (LUFS).

    사람이 느끼는 크기라서, 최대값보다 이쪽이 맞습니다.
    잴 수 없거나 사실상 무음이면 ``None`` 을 냅니다.

    **최대값(dBFS)이 아니라 LUFS 로 재는 이유가 있습니다.** 모노 파일을
    스테레오로 펼치면 FFmpeg 가 좌우로 나눠 담아 최대값이 3dB 내려갑니다.
    최대값으로 맞추면 모노 파일만 3dB 작게 깔리는데, **AI 음성은 거의 다
    모노입니다.** LUFS 는 좌우 에너지를 합쳐서 보기 때문에 펼치든 말든
    같은 값이 나옵니다. 그래서 이쪽이 안전합니다.

    그래도 합성할 때와 **똑같은 차림으로** 재 둡니다 — 나중에 앞단이
    바뀌어도 재는 값과 실제 값이 어긋나지 않게.
    """
    try:
        text = ffmpeg.run(
            ["-nostats", "-i", str(path),
             "-af", f"aresample={AUDIO_RATE},aformat=channel_layouts=stereo,ebur128",
             "-f", "null", "-"],
            user_message="소리 크기를 재지 못했습니다.")
    except FfmpegFailed:
        return None

    m = re.search(r"Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+)\s*LUFS", text)
    if not m:
        찾은것 = re.findall(r"I:\s*(-?[\d.]+)\s*LUFS", text)
        if not 찾은것:
            return None
        m = None
    값 = float(m.group(1)) if m else float(찾은것[-1])
    return None if 값 <= SILENCE_LUFS else 값


def gain_to_reach(measured: Optional[float], target: float) -> float:
    """목표 크기까지 몇 dB 올리거나 내려야 하는지. 못 쟀으면 그대로 둡니다."""
    if measured is None:
        return 0.0
    return max(-GAIN_LIMIT_DB, min(GAIN_LIMIT_DB, target - measured))


# ─────────────────────────────────────────────────────────────
# 합성 전 검사 (§8 — 돈과 시간을 쓰기 전에)
# ─────────────────────────────────────────────────────────────


def validate_length(cuts: Sequence[Cut]) -> float:
    """총 길이를 봅니다. 30초를 넘으면 **합성을 시작하지 않습니다.**

    자동으로 잘라내지 않습니다. 어느 장면을 줄일지는 담당자가 정합니다 (§8).
    """
    if not cuts:
        raise PlanRejected(
            user_message="이어붙일 장면이 없습니다.",
            hints=("먼저 장면을 만들어 주세요.",))

    total = sum(c.use_sec for c in cuts)
    if total > MAX_TOTAL_SEC:
        긴것 = max(cuts, key=lambda c: c.use_sec)
        raise PlanRejected(
            user_message=f"영상이 {total:g}초입니다. {MAX_TOTAL_SEC:g}초까지 됩니다.",
            hints=(f"장면 {긴것.scene_idx} 이 {긴것.use_sec:g}초로 가장 깁니다.",
                   f"모두 합쳐 {total - MAX_TOTAL_SEC:g}초를 줄여주세요."))
    for c in cuts:
        if c.use_sec <= 0:
            raise PlanRejected(
                user_message=f"장면 {c.scene_idx} 의 길이가 0초입니다.",
                hints=("길이를 1초 이상으로 정해주세요.",))
        if not c.source.is_file():
            raise PlanRejected(
                user_message=f"장면 {c.scene_idx} 의 영상 파일이 없습니다.",
                hints=("그 장면을 다시 만들어 주세요.",))
    return total


# ─────────────────────────────────────────────────────────────
# 필터 만들기
# ─────────────────────────────────────────────────────────────


def _video_chain(cuts: Sequence[Cut]) -> tuple[list[str], str]:
    """토막들을 이어붙이는 필터. 규격을 맞춰 놓고 붙입니다.

    공급자마다 크기·프레임률·화소비가 다를 수 있어서, 붙이기 전에
    **하나씩 규격을 맞춥니다.** 안 맞으면 이어붙이기가 실패하거나 화면이 튑니다.
    """
    parts: list[str] = []
    for i, c in enumerate(cuts):
        parts.append(
            f"[{i}:v]trim=0:{c.use_sec:.3f},setpts=PTS-STARTPTS,"
            f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={VIDEO_WIDTH}:{VIDEO_HEIGHT},fps={VIDEO_FPS},setsar=1[v{i}]")
    붙일것 = "".join(f"[v{i}]" for i in range(len(cuts)))
    parts.append(f"{붙일것}concat=n={len(cuts)}:v=1:a=0[vcat]")
    return parts, "[vcat]"


def _voice_chain(cuts: Sequence[Cut], first_input: int,
                 gains: Optional[dict[int, float]] = None
                 ) -> tuple[list[str], str, int]:
    """말소리 트랙. 없는 장면은 그 길이만큼 조용하게 채웁니다.

    Stage 7(음성) 전에는 전부 조용합니다. 그래도 소리 트랙은 만들어 둡니다 —
    소리가 아예 없는 MP4 는 일부 앱에서 재생이 이상해집니다.

    ``gains`` 는 장면 번호별로 몇 dB 올릴지입니다. 장면마다 크기를 맞춰서
    어떤 장면만 유난히 작게 들리는 일을 막습니다.
    """
    parts: list[str] = []
    다음입력 = first_input
    gains = gains or {}
    for i, c in enumerate(cuts):
        if c.voice and Path(c.voice).is_file():
            g = gains.get(i, 0.0)
            맞추기 = f"volume={g:.2f}dB," if abs(g) >= 0.05 else ""
            parts.append(
                f"[{다음입력}:a]aresample={AUDIO_RATE},aformat=channel_layouts=stereo,"
                f"{맞추기}"
                f"apad,atrim=0:{c.use_sec:.3f},asetpts=PTS-STARTPTS[a{i}]")
            다음입력 += 1
        else:
            parts.append(
                f"anullsrc=r={AUDIO_RATE}:cl=stereo,"
                f"atrim=0:{c.use_sec:.3f},asetpts=PTS-STARTPTS[a{i}]")
    붙일것 = "".join(f"[a{i}]" for i in range(len(cuts)))
    parts.append(f"{붙일것}concat=n={len(cuts)}:v=0:a=1[avoice]")
    return parts, "[avoice]", 다음입력


def _bgm_chain(bgm_input: int, total: float, gain_db: float) -> tuple[list[str], str]:
    """배경음악. 말소리보다 작게 깔고, 길면 자르고 짧으면 반복합니다 (§8)."""
    시작페이드 = min(BGM_FADE_SEC, total / 4)
    끝페이드 = min(BGM_FADE_SEC, total / 4)
    return ([
        f"[{bgm_input}:a]aresample={AUDIO_RATE},aformat=channel_layouts=stereo,"
        f"aloop=loop=-1:size=2e9,atrim=0:{total:.3f},asetpts=PTS-STARTPTS,"
        f"volume={gain_db}dB,"
        f"afade=t=in:st=0:d={시작페이드:.2f},"
        f"afade=t=out:st={max(total - 끝페이드, 0):.2f}:d={끝페이드:.2f}[abgm]"
    ], "[abgm]")


def _subtitle_chain(vin: str, ass: Path,
                    fonts_dir: Optional[Path]) -> tuple[list[str], str]:
    """자막을 굽습니다 (§7). 맨 마지막입니다 — 그래야 글자가 안 뭉개집니다."""
    f = str(ass).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    chain = f"{vin}subtitles=filename='{f}'"
    if fonts_dir:
        d = str(fonts_dir).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
        chain += f":fontsdir='{d}'"
    return [f"{chain}[vout]"], "[vout]"


# ─────────────────────────────────────────────────────────────
# 합성
# ─────────────────────────────────────────────────────────────


class Compositor:
    """``Compositor`` 계약을 지킵니다 (``app/contracts/providers.py``)."""

    def __init__(self, ffmpeg: Optional[Ffmpeg] = None) -> None:
        self._ffmpeg = ffmpeg or Ffmpeg()

    def validate_length(self, scenes: Sequence[Scene]) -> None:
        validate_length(cuts_from_scenes(scenes))

    def compose(self, *, cuts: Sequence[Cut], dest: Path,
                subtitle_ass: Optional[Path] = None,
                bgm: Optional[Path] = None,
                fonts_dir: Optional[Path] = None,
                bgm_gain_db: float = BGM_GAIN_DB) -> Path:
        """완성본 하나를 만듭니다.

        먼저 길이를 봅니다. 30초를 넘으면 **여기서 멈춥니다** (§8).
        """
        total = validate_length(cuts)          # 넘으면 여기서 PlanRejected
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)

        args: list[str] = ["-y"]
        for c in cuts:
            args += ["-i", str(c.source)]

        목소리있는것 = [c for c in cuts if c.voice and Path(c.voice).is_file()]
        for c in 목소리있는것:
            args += ["-i", str(c.voice)]

        bgm_input = -1
        if bgm and Path(bgm).is_file():
            bgm_input = len(cuts) + len(목소리있는것)
            args += ["-i", str(bgm)]

        # ── 소리 크기를 먼저 잽니다 (§8) ──
        # 같은 파일을 두 번 재지 않도록 기억해 둡니다.
        잰것: dict[str, Optional[float]] = {}

        def 재기(p: Path) -> Optional[float]:
            키 = str(p)
            if 키 not in 잰것:
                잰것[키] = measure_lufs(p, self._ffmpeg)
            return 잰것[키]

        voice_gains: dict[int, float] = {}
        for i, c in enumerate(cuts):
            if c.voice and Path(c.voice).is_file():
                voice_gains[i] = gain_to_reach(재기(Path(c.voice)),
                                               VOICE_TARGET_LUFS)

        # ── 필터를 조각으로 만들어 붙입니다 ──
        parts, vlabel = _video_chain(cuts)

        vparts, vout, _ = _voice_chain(cuts, first_input=len(cuts),
                                       gains=voice_gains)
        parts += vparts
        alabel = vout

        if bgm_input >= 0:
            # bgm_gain_db 는 「**말소리 대비** 몇 dB」 입니다 (§8).
            # 음원을 재서 그만큼 아래로 **맞춥니다.** 못 재면 그냥 줄입니다.
            잰크기 = 재기(Path(bgm))
            실제gain = (bgm_gain_db if 잰크기 is None
                        else gain_to_reach(잰크기, VOICE_TARGET_LUFS + bgm_gain_db))
            bparts, blabel = _bgm_chain(bgm_input, total, 실제gain)
            parts += bparts
            # normalize=0 이 중요합니다. **기본값은 입력 개수로 나눕니다.**
            # 그대로 두면 BGM 이 -18dB 가 아니라 -24dB 가 되어 거의 안 들립니다.
            # §8 은 「voice 대비 -18dB」 라고 했으므로, 나누지 않고 더해야
            # 말소리와의 차이가 정확히 -18dB 가 됩니다.
            # 더하면 넘칠 수 있어 alimiter 로 눌러 줍니다.
            #
            # duration=first — 말소리 길이에 맞춥니다. BGM 이 길어도 늘어나지 않습니다.
            parts.append(f"{alabel}{blabel}amix=inputs=2:duration=first:"
                         f"normalize=0:dropout_transition=0,"
                         f"alimiter=limit=0.95[aout]")
            alabel = "[aout]"

        if subtitle_ass and Path(subtitle_ass).is_file():
            sparts, vlabel = _subtitle_chain(vlabel, Path(subtitle_ass), fonts_dir)
            parts += sparts

        args += [
            "-filter_complex", ";".join(parts),
            "-map", vlabel, "-map", alabel,
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-pix_fmt", "yuv420p", "-r", str(VIDEO_FPS),
            "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", str(AUDIO_RATE),
            "-movflags", "+faststart",
            "-t", f"{total:.3f}",          # 30초를 넘길 수 없게 한 번 더 못을 박습니다
            str(dest),
        ]

        self._ffmpeg.run(
            args, user_message="영상을 합치지 못했습니다. 다시 시도해 주세요.")

        if not dest.is_file() or dest.stat().st_size == 0:
            raise FfmpegFailed(
                user_message="영상을 합치지 못했습니다. 다시 시도해 주세요.",
                log=f"output missing: {dest}", args=args)
        return dest
