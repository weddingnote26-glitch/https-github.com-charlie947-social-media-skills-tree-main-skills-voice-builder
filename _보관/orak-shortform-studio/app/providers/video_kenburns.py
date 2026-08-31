"""실제 사진을 천천히 움직여 영상으로 (지시서 §1-1 · §6b).

**Kling 을 부르지 않습니다. 그래서 0원입니다.**
한 편 비용의 대부분이 영상 생성에서 나오므로, 음식·매장 장면은 여기서 만듭니다.

Kling 과 **같은 인터페이스**(넣기 → 확인 → 받기)를 씁니다. 다만 여기서는
넣는 순간 이미 끝나 있고, 확인이 곧바로 「됐다」 고 답합니다.
그래야 파이프라인이 두 갈래로 갈라지지 않습니다.

「AI 생성 이미지」 표기는 ``drawtext`` 대신 **Pillow 로 글자를 그려 얹습니다.**
동봉하는 FFmpeg 빌드에 따라 drawtext 가 없을 수 있고, 한글은 Pillow 쪽이
훨씬 예측 가능하며, 자막과 **같은 글꼴**을 쓰게 되어 보기에도 일관됩니다.
"""

from __future__ import annotations

import time
from enum import Enum
from pathlib import Path
from typing import Optional, Sequence

from app.contracts.models import (
    VIDEO_FPS,
    VIDEO_HEIGHT,
    VIDEO_WIDTH,
    CostEstimate,
    VideoJob,
    VideoJobState,
    VideoOutcome,
    VideoRequest,
)
from app.core.ffmpeg import Ffmpeg, FfmpegFailed

# 움직임을 만들 여유. 원본을 이 배수로 키운 뒤 그 안에서 움직입니다.
# 1배로 하면 확대할 여유가 없어 화면이 튑니다.
OVERSAMPLE = 2

ZOOM_PER_FRAME = 0.0012
"""한 프레임마다 커지는 정도. 5초(150프레임)에 약 1.18배가 됩니다.
더 빠르면 「확 당기는」 느낌이라 맛집 영상에 안 맞습니다.
"""
ZOOM_MAX = 1.18


class Move(str, Enum):
    """어떻게 움직일까. 장면마다 다르게 주면 영상이 심심하지 않습니다."""

    ZOOM_IN = "zoom_in"
    ZOOM_OUT = "zoom_out"
    PAN_LEFT = "pan_left"
    PAN_RIGHT = "pan_right"
    PAN_UP = "pan_up"
    PAN_DOWN = "pan_down"


# 장면 번호로 돌려가며 씁니다. 같은 움직임이 이어지지 않게.
_ROTATION = (Move.ZOOM_IN, Move.PAN_RIGHT, Move.ZOOM_OUT, Move.PAN_LEFT,
             Move.ZOOM_IN, Move.PAN_UP)


def move_for_scene(idx: int) -> Move:
    return _ROTATION[(idx - 1) % len(_ROTATION)]


def _zoompan_expr(move: Move, frames: int) -> tuple[str, str, str]:
    """(z, x, y) 식을 만듭니다.

    zoompan 안에서 ``on`` 은 지금 몇 번째 프레임인지, ``iw``/``ih`` 는 입력 크기,
    ``zoom`` 은 지금 배율입니다.
    """
    z_in = f"min(zoom+{ZOOM_PER_FRAME},{ZOOM_MAX})"
    z_out = f"max({ZOOM_MAX}-{ZOOM_PER_FRAME}*on,1.0)"
    가운데_x = "iw/2-(iw/zoom/2)"
    가운데_y = "ih/2-(ih/zoom/2)"

    if move is Move.ZOOM_IN:
        return z_in, 가운데_x, 가운데_y
    if move is Move.ZOOM_OUT:
        return z_out, 가운데_x, 가운데_y

    # 팬은 살짝 확대해 둔 상태에서 옆으로 흐릅니다. 확대가 없으면 움직일 자리가 없습니다.
    z_pan = "1.10"
    폭 = f"(iw-iw/{z_pan})"
    높이 = f"(ih-ih/{z_pan})"
    진행 = f"(on/{max(frames - 1, 1)})"

    if move is Move.PAN_RIGHT:
        return z_pan, f"{폭}*{진행}", 가운데_y
    if move is Move.PAN_LEFT:
        return z_pan, f"{폭}*(1-{진행})", 가운데_y
    if move is Move.PAN_DOWN:
        return z_pan, 가운데_x, f"{높이}*{진행}"
    return z_pan, 가운데_x, f"{높이}*(1-{진행})"


def build_filter(move: Move, frames: int, *, width: int = VIDEO_WIDTH,
                 height: int = VIDEO_HEIGHT, fps: int = VIDEO_FPS) -> str:
    """사진 한 장을 9:16 영상으로 바꾸는 필터 사슬.

    1. 9:16 을 **덮도록** 키우고 잘라냅니다. 사진이 가로든 세로든 여백이 안 생깁니다.
    2. 움직일 여유를 두려고 목표보다 크게 만듭니다.
    3. zoompan 으로 천천히 움직입니다.
    4. yuv420p 로 맞춥니다. 이게 없으면 어떤 기기에서 재생이 안 됩니다.
    """
    big_w, big_h = width * OVERSAMPLE, height * OVERSAMPLE
    z, x, y = _zoompan_expr(move, frames)
    return (
        f"scale={big_w}:{big_h}:force_original_aspect_ratio=increase,"
        f"crop={big_w}:{big_h},"
        f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={width}x{height}:fps={fps},"
        f"setsar=1,format=yuv420p"
    )


class KenBurnsProvider:
    """``VideoProvider`` 계약을 지킵니다 (``app/contracts/providers.py``)."""

    name = "kenburns"

    def __init__(self, ffmpeg: Optional[Ffmpeg] = None,
                 ai_notice_png: Optional[Path] = None) -> None:
        """
        Args:
            ai_notice_png: 「AI 생성 이미지」 라고 미리 그려둔 투명 PNG.
                주면 우하단에 얹습니다. 실제 사진 장면에는 주지 마세요 (§1-1).
        """
        self._ffmpeg = ffmpeg or Ffmpeg()
        self._ai_notice = Path(ai_notice_png) if ai_notice_png else None
        self._done: dict[str, Path] = {}

    # ── 연결 확인 ─────────────────────────────────────────
    def health(self) -> tuple[bool, str]:
        try:
            if not self._ffmpeg.has_filter("zoompan"):
                return False, "영상 만들기 도구가 이 기능을 지원하지 않습니다. 회사에 문의해 주세요."
        except Exception:
            return False, "영상 만들기 도구를 찾지 못했습니다. 회사에 문의해 주세요."
        return True, "사진으로 영상 만들기를 쓸 수 있습니다."

    # ── 비용 ──────────────────────────────────────────────
    def estimate(self, req: VideoRequest) -> CostEstimate:
        """**0원입니다.** 이 컴퓨터에서 만들기 때문입니다."""
        return CostEstimate(krw=0, breakdown=(("사진 움직이기", 0),))

    # ── 만들기 ────────────────────────────────────────────
    def submit(self, req: VideoRequest) -> VideoJob:
        """만듭니다. Kling 과 달리 **이 자리에서 끝납니다.**

        그래도 손잡이를 돌려주는 이유는 파이프라인이 Kling 과 같은 길을 걷게 하기 위해서입니다.
        """
        if req.source_photo is None:
            raise FfmpegFailed(
                user_message="이 장면에 쓸 사진이 없습니다. 사진을 골라주세요.",
                log="source_photo is None", args=[])
        photo = Path(req.source_photo)
        if not photo.is_file():
            raise FfmpegFailed(
                user_message="고르신 사진을 찾지 못했습니다. 다시 골라주세요.",
                log=f"missing: {photo}", args=[])

        key = req.external_task_id or f"{self.name}-{req.scene_idx}-{time.time()}"
        self._pending = (key, req, photo)
        return VideoJob(provider=self.name, scene_idx=req.scene_idx,
                        external_task_id=key, vendor_task_id=key,
                        submitted_at=time.time())

    def render(self, req: VideoRequest, dest: Path) -> Path:
        """사진 한 장 → 영상 한 개. 실제로 만드는 곳입니다.

        ``dest`` 는 부르는 쪽이 정합니다. 프로젝트 폴더 안이어야 합니다.
        """
        photo = Path(req.source_photo)  # type: ignore[arg-type]
        seconds = float(req.request_sec)
        frames = max(int(round(seconds * VIDEO_FPS)), 1)
        move = move_for_scene(req.scene_idx)

        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)

        chain = build_filter(move, frames)
        args: list[str] = ["-y", "-i", str(photo)]

        if self._ai_notice and self._ai_notice.is_file():
            # 표기를 얹습니다 (§1-1). 우하단, 여백 36px.
            args += ["-i", str(self._ai_notice)]
            filter_complex = (
                f"[0:v]{chain}[bg];"
                f"[bg][1:v]overlay=W-w-36:H-h-96:format=auto,format=yuv420p[out]"
            )
            args += ["-filter_complex", filter_complex, "-map", "[out]"]
        else:
            args += ["-vf", chain]

        args += [
            "-frames:v", str(frames),
            "-r", str(VIDEO_FPS),
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-an",                     # 소리는 나중에 따로 붙입니다 (§8)
            str(dest),
        ]
        self._ffmpeg.run(
            args, user_message="사진으로 영상을 만들지 못했습니다. 다른 사진으로 해보세요.")

        if not dest.is_file() or dest.stat().st_size == 0:
            raise FfmpegFailed(
                user_message="사진으로 영상을 만들지 못했습니다. 다시 시도해 주세요.",
                log=f"output missing or empty: {dest}", args=args)

        self._done[req.external_task_id or ""] = dest
        return dest

    # ── 확인 ──────────────────────────────────────────────
    def poll(self, jobs: Sequence[VideoJob]) -> list[VideoJobState]:
        """만들기가 이미 끝났으므로 곧바로 「됐다」 고 답합니다.

        Kling 은 여기서 서버에 물어봅니다. 파이프라인은 그 차이를 모릅니다.
        """
        out: list[VideoJobState] = []
        for job in jobs:
            local = self._done.get(job.external_task_id)
            out.append(VideoJobState(
                job=job,
                outcome=VideoOutcome.SUCCEEDED,
                remote_url=str(local) if local else "",
                duration_sec=0.0,
            ))
        return out

    def download(self, state: VideoJobState, dest: Path) -> Path:
        """이미 로컬에 있습니다. 내려받을 게 없습니다.

        계약에 있으니 만들어 두었습니다. Kling 은 여기서 30일 만료 전에
        실제로 파일을 가져옵니다.
        """
        made = self._done.get(state.job.external_task_id)
        return made if made else Path(dest)


def make_ai_notice_png(dest: Path, *, font_path: Optional[Path] = None,
                       text: str = "AI 생성 이미지", size: int = 34) -> Path:
    """「AI 생성 이미지」 표기를 투명 PNG 로 그립니다 (§1-1).

    실제 매장 사진으로 오인시키면 안 되므로, 만들어 넣은 이미지에는 이 표기가 붙습니다.
    """
    from PIL import Image, ImageDraw, ImageFont

    후보 = [font_path] if font_path else []
    후보 += [
        Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
        Path("C:/Windows/Fonts/malgun.ttf"),
    ]
    font = None
    for f in 후보:
        if f and Path(f).is_file():
            try:
                font = ImageFont.truetype(str(f), size)
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()

    측정 = Image.new("RGBA", (10, 10))
    box = ImageDraw.Draw(측정).textbbox((0, 0), text, font=font)
    pad_x, pad_y = 14, 8
    w = box[2] - box[0] + pad_x * 2
    h = box[3] - box[1] + pad_y * 2

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=6, fill=(0, 0, 0, 150))
    d.text((pad_x - box[0], pad_y - box[1]), text, font=font, fill=(255, 255, 255, 235))

    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest)
    return dest
