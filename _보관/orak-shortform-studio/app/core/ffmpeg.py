"""FFmpeg 를 찾아서 안전하게 부르는 곳.

**두 가지를 반드시 지킵니다.**

1. **명령을 문자열로 잇지 않습니다.** 항상 리스트로 넘깁니다 (지시서 §3).
   경로에 공백이 있으면(「오락이 마스터 파일」 처럼) 문자열 연결은 거기서 깨집니다.
2. **파일을 지우지 않습니다.** 덮어쓰기(-y)도 부르는 쪽이 명시해야 합니다.

FFmpeg 를 어디서 찾는가 (§8 — 담당자가 따로 설치하면 안 됩니다):

    1. 프로그램에 동봉된 것        ← 배포본은 이것
    2. imageio-ffmpeg (pip)        ← 개발 중에는 이것
    3. PATH 에 있는 것             ← 마지막 수단

**ffprobe 는 쓰지 않습니다.** 동봉본에 없을 수 있어서, 영상 정보는 ffmpeg 로 읽습니다.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

DEFAULT_TIMEOUT = 600
"""한 번 부를 때 최대 기다리는 시간(초). 10분이면 어떤 장면도 충분합니다."""


class FfmpegNotFound(Exception):
    """FFmpeg 를 찾지 못했습니다. 담당자에게 보여줄 한국어를 담습니다."""

    def __init__(self) -> None:
        super().__init__("영상 만들기 도구를 찾지 못했습니다. 회사에 문의해 주세요.")
        self.user_message = "영상 만들기 도구를 찾지 못했습니다. 회사에 문의해 주세요."


class FfmpegFailed(Exception):
    """FFmpeg 가 실패했습니다.

    ``log`` 는 **로그 파일에만** 남깁니다. 화면에는 ``user_message`` 만 보여줍니다 (§9).
    """

    def __init__(self, *, user_message: str, log: str, args: Sequence[str]) -> None:
        super().__init__(user_message)
        self.user_message = user_message
        self.log = log
        self.args = list(args)


def find_ffmpeg(bundled_dir: Optional[Path] = None) -> Path:
    """FFmpeg 실행 파일을 찾습니다."""
    name = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"

    if bundled_dir:
        p = Path(bundled_dir) / name
        if p.is_file():
            return p

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        p = Path(meipass) / "ffmpeg" / name
        if p.is_file():
            return p

    try:
        import imageio_ffmpeg

        return Path(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        pass

    found = shutil.which("ffmpeg")
    if found:
        return Path(found)

    raise FfmpegNotFound()


@dataclass(frozen=True)
class MediaInfo:
    """영상·이미지에서 읽어낸 것."""

    width: int
    height: int
    duration_sec: float
    fps: float
    has_video: bool
    has_audio: bool


class Ffmpeg:
    """FFmpeg 한 자루. 부르는 쪽은 리스트만 넘기면 됩니다."""

    def __init__(self, exe: Optional[Path] = None,
                 bundled_dir: Optional[Path] = None) -> None:
        self.exe = Path(exe) if exe else find_ffmpeg(bundled_dir)

    def version(self) -> str:
        out = self._run([str(self.exe), "-hide_banner", "-version"])
        return out.splitlines()[0] if out else ""

    def has_filter(self, name: str) -> bool:
        """이 FFmpeg 가 그 필터를 갖고 있는가.

        동봉본마다 빌드가 달라서, 없는 필터를 쓰면 실행 도중에 죽습니다.
        미리 물어보고 다른 길로 갑니다.
        """
        # 주의: 없는 필터를 물어봐도 ffmpeg 는 **종료코드 0** 을 냅니다.
        # 그래서 예외만 보면 「없는데 있다」 고 답하게 됩니다. 출력을 봐야 합니다.
        try:
            out = self._run([str(self.exe), "-hide_banner", "-h", f"filter={name}"])
        except FfmpegFailed as e:
            out = e.log
        return "Unknown filter" not in out

    # ── 실행 ──────────────────────────────────────────────
    def run(self, args: Sequence[str], *, timeout: int = DEFAULT_TIMEOUT,
            user_message: str = "영상을 만들지 못했습니다. 다시 시도해 주세요.") -> str:
        """FFmpeg 를 부릅니다.

        Args:
            args: ``ffmpeg`` 뒤에 붙는 인자들. **리스트여야 합니다** (§3).
                  경로에 공백이 있어도 이 방식이면 깨지지 않습니다.
        """
        if isinstance(args, str):
            raise TypeError(
                "인자를 문자열로 넘기지 마세요. 경로에 공백이 있으면 깨집니다. "
                "리스트로 넘겨주세요.")
        return self._run([str(self.exe), "-hide_banner", "-nostdin", *map(str, args)],
                         timeout=timeout, user_message=user_message)

    def _run(self, cmd: list[str], *, timeout: int = DEFAULT_TIMEOUT,
             user_message: str = "영상을 만들지 못했습니다. 다시 시도해 주세요.") -> str:
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout,
                encoding="utf-8", errors="replace",
                # shell=False 가 기본입니다. 절대 True 로 바꾸지 마세요 —
                # 파일 이름에 든 글자가 명령으로 실행될 수 있습니다.
            )
        except subprocess.TimeoutExpired as exc:
            raise FfmpegFailed(
                user_message="영상 만들기가 너무 오래 걸려 멈췄습니다. 다시 시도해 주세요.",
                log=f"timeout after {timeout}s", args=cmd) from None
        except OSError as exc:
            raise FfmpegFailed(
                user_message="영상 만들기 도구를 실행하지 못했습니다. 회사에 문의해 주세요.",
                log=str(exc), args=cmd) from None

        if proc.returncode != 0:
            raise FfmpegFailed(user_message=user_message,
                               log=(proc.stderr or proc.stdout or "")[-4000:], args=cmd)
        return proc.stdout + proc.stderr

    # ── 읽기 (ffprobe 없이) ───────────────────────────────
    def probe(self, path: Path) -> MediaInfo:
        """영상·이미지 정보를 읽습니다. **ffprobe 가 없어도 됩니다.**

        ``ffmpeg -i`` 는 입력만 주면 정보를 stderr 로 뱉고 오류로 끝납니다.
        그 출력을 읽습니다.
        """
        try:
            text = self._run([str(self.exe), "-hide_banner", "-i", str(path)])
        except FfmpegFailed as e:
            text = e.log
            if "No such file" in text or "Invalid data" in text:
                raise FfmpegFailed(
                    user_message="사진을 읽지 못했습니다. 다른 사진으로 해보세요.",
                    log=text, args=[str(path)]) from None

        w = h = 0
        if m := re.search(r"Stream #\d+:\d+.*?Video:.*?,\s*(\d{2,5})x(\d{2,5})", text, re.S):
            w, h = int(m.group(1)), int(m.group(2))

        duration = 0.0
        if m := re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", text):
            duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))

        fps = 0.0
        if m := re.search(r"([\d.]+)\s*fps", text):
            fps = float(m.group(1))

        return MediaInfo(
            width=w, height=h, duration_sec=duration, fps=fps,
            has_video=bool(re.search(r"Video:", text)),
            has_audio=bool(re.search(r"Audio:", text)),
        )
