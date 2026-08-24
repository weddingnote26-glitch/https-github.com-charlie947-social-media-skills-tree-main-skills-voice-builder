# -*- coding: utf-8 -*-
"""
받은 이미지를 최종 JPEG 로 만듭니다.

  · OpenAI 가 주는 세로 규격(1024x1536)을 사양의 1200x1500(4:5)로 맞춥니다.
  · 늘려서 찌그러뜨리지 않고, 짧은 쪽을 채운 뒤 가운데를 잘라 냅니다.
  · RGB · 품질 95 · optimize 로 저장합니다.
"""

from __future__ import annotations

import io
import shutil
from pathlib import Path

from PIL import Image


def unique_path(out_dir: Path, base: str, ext: str = ".jpg") -> Path:
    """이름이 겹치면 _01, _02 를 붙입니다."""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{base}{ext}"
    n = 1
    while path.exists():
        path = out_dir / f"{base}_{n:02d}{ext}"
        n += 1
    return path


def save_raw(data: bytes, out_dir: Path, base: str) -> Path:
    """원본을 손대지 않고 그대로 보관합니다."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(io.BytesIO(data)) as probe:
        ext = "." + (probe.format or "PNG").lower().replace("jpeg", "jpg")
    path = unique_path(out_dir, base, ext)
    path.write_bytes(data)
    return path


def _cover_crop(im: Image.Image, w: int, h: int) -> Image.Image:
    """가로세로 비율을 지키며 채우고 가운데를 잘라 냅니다."""
    src_w, src_h = im.size
    scale = max(w / src_w, h / src_h)
    new = (max(w, round(src_w * scale)), max(h, round(src_h * scale)))
    im = im.resize(new, Image.LANCZOS)
    left = (im.width - w) // 2
    top = (im.height - h) // 2
    return im.crop((left, top, left + w, top + h))


def to_final_jpeg(src: Path | bytes, out_path: Path, style: dict) -> Path:
    """최종 JPEG 를 만듭니다. 돌려주는 값은 실제로 저장된 경로입니다."""
    cv = style["canvas"]
    data = src.read_bytes() if isinstance(src, Path) else src
    with Image.open(io.BytesIO(data)) as im:
        im = im.convert(cv.get("color_mode", "RGB"))
        if im.size != (cv["width"], cv["height"]):
            im = _cover_crop(im, cv["width"], cv["height"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        im.save(out_path, "JPEG",
                quality=int(cv.get("quality", 95)),
                optimize=bool(cv.get("optimize", True)))
    return out_path


def copy_to(path: Path, dest_dir: Path) -> Path:
    """같은 파일명으로 다른 폴더에도 둡니다. 겹치면 번호를 붙입니다."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = dest_dir / path.name
    if target.exists():
        target = unique_path(dest_dir, path.stem, path.suffix)
    shutil.copy2(path, target)
    return target


def verify_jpeg(path: Path, style: dict) -> list[str]:
    """저장된 파일이 사양대로인지 실제로 열어서 확인합니다."""
    cv = style["canvas"]
    bad: list[str] = []
    if not path.exists():
        return [f"파일이 없습니다: {path}"]
    if path.stat().st_size < 5000:
        bad.append(f"파일이 너무 작습니다 ({path.stat().st_size} 바이트)")
    try:
        with Image.open(path) as im:
            if im.format != "JPEG":
                bad.append(f"형식이 {im.format} 입니다 (JPEG 여야 합니다)")
            if im.mode != cv.get("color_mode", "RGB"):
                bad.append(f"색 모드가 {im.mode} 입니다 (RGB 여야 합니다)")
            if im.size != (cv["width"], cv["height"]):
                bad.append(f"규격이 {im.size} 입니다 ({cv['width']}x{cv['height']} 여야 합니다)")
    except OSError as exc:
        bad.append(f"이미지를 열지 못했습니다: {exc}")
    return bad
