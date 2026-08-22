# -*- coding: utf-8 -*-
"""
이미지 검사 — 네이버 포토 업로더로 올리기 전에 확인합니다.

  네이버는 복사·붙여넣기로 넣은 이미지의 원본이 옮겨지거나 지워지면
  이미지가 사라질 수 있다고 안내합니다.
  그래서 이 시스템은 이미지를 **파일로 준비해서 포토 업로더로 직접 올리도록** 합니다.
"""
from __future__ import annotations

import re
from pathlib import Path

# 네이버가 받는 형식
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif"}

# 네이버 안내 기준
NAVER_MAX_COUNT = 50
NAVER_MAX_TOTAL_MB = 100

# 실제 운영에서 관리하기 좋은 범위
RECOMMEND_MIN = 2
RECOMMEND_MAX = 8

# 파일 하나가 이보다 크면 업로드가 느려지거나 실패할 수 있습니다.
WARN_SINGLE_MB = 10

SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def _mb(n: int) -> float:
    return round(n / (1024 * 1024), 2)


def size_text(n: int) -> str:
    """사람이 읽기 좋은 용량 표기. 작은 파일은 KB 로 보여 줍니다."""
    if n < 1024:
        return f"{n}B"
    if n < 1024 * 1024:
        return f"{round(n / 1024)}KB"
    return f"{_mb(n)}MB"


def check(declared: list, refs: list[str], img_dir: Path) -> dict:
    """
    declared : post.md 앞머리의 images 목록
    refs     : 본문에 나온 [이미지:파일명] 순서
    img_dir  : 실제 이미지가 든 폴더

    반환: {"errors": [...], "warnings": [...], "files": [...], "total_mb": float}
    """
    errors: list[str] = []
    warnings: list[str] = []
    files: list[dict] = []

    declared_files = [str(d.get("file", "")) for d in declared
                      if isinstance(d, dict) and d.get("file")]

    # ── 1. 개수 ────────────────────────────────────────────
    n = len(refs)
    if n == 0:
        errors.append("본문에 이미지가 하나도 없습니다.")
    if n > NAVER_MAX_COUNT:
        errors.append(f"이미지가 {n}장입니다. 네이버는 한 글에 "
                      f"{NAVER_MAX_COUNT}장까지 받습니다.")
    elif n > RECOMMEND_MAX:
        warnings.append(f"이미지가 {n}장입니다. "
                        f"{RECOMMEND_MAX}장 이하가 관리하기 좋습니다.")
    elif 0 < n < RECOMMEND_MIN:
        warnings.append(f"이미지가 {n}장뿐입니다. "
                        f"{RECOMMEND_MIN}장 이상을 권합니다.")

    # ── 2. 본문 순서와 앞머리 목록이 맞는가 ────────────────
    if declared_files != refs:
        only_declared = [f for f in declared_files if f not in refs]
        only_body = [f for f in refs if f not in declared_files]
        if only_declared:
            errors.append(f"앞머리에 적었지만 본문에 없는 이미지: "
                          f"{', '.join(only_declared)}")
        if only_body:
            errors.append(f"본문에 있지만 앞머리에 없는 이미지: "
                          f"{', '.join(only_body)}")
        if not only_declared and not only_body:
            errors.append("이미지 순서가 앞머리 목록과 본문에서 서로 다릅니다.")

    # ── 3. 파일 하나하나 ───────────────────────────────────
    total_bytes = 0
    for idx, name in enumerate(refs, 1):
        info: dict = {"no": idx, "file": name, "ok": True}
        path = img_dir / name

        if not SAFE_NAME_RE.match(name):
            errors.append(f"[{name}] 파일명은 영문·숫자로 시작하고 "
                          f"영문·숫자·-·_·. 만 쓸 수 있습니다.")
            info["ok"] = False

        ext = Path(name).suffix.lower()
        if ext not in ALLOWED_EXT:
            errors.append(f"[{name}] 네이버가 받지 않는 형식입니다. "
                          f"({', '.join(sorted(ALLOWED_EXT))} 만 가능)")
            info["ok"] = False

        if not path.exists():
            errors.append(f"[{name}] 파일이 없습니다: {path}")
            info["ok"] = False
            info["size_mb"] = 0.0
            info["size_text"] = "없음"
        else:
            size = path.stat().st_size
            total_bytes += size
            info["size_mb"] = _mb(size)
            info["size_text"] = size_text(size)
            if size == 0:
                errors.append(f"[{name}] 파일 크기가 0입니다. 빈 파일입니다.")
                info["ok"] = False
            elif _mb(size) > WARN_SINGLE_MB:
                warnings.append(f"[{name}] {_mb(size)}MB 로 큽니다. "
                                f"업로드가 느릴 수 있습니다.")

        # 캡션(대체 텍스트)
        match = next((d for d in declared
                      if isinstance(d, dict) and d.get("file") == name), None)
        if match is None:
            info["alt"] = None
        else:
            alt = str(match.get("alt") or "").strip()
            info["alt"] = alt or None
            info["position"] = match.get("position")
            if not alt:
                errors.append(f"[{name}] 대체 텍스트(alt)가 비어 있습니다.")
                info["ok"] = False
            elif len(alt) < 5:
                warnings.append(f"[{name}] 대체 텍스트가 너무 짧습니다: 「{alt}」")

        files.append(info)

    total_mb = _mb(total_bytes)
    if total_mb > NAVER_MAX_TOTAL_MB:
        errors.append(f"이미지 전체 용량이 {total_mb}MB 입니다. "
                      f"네이버 기준 {NAVER_MAX_TOTAL_MB}MB 를 넘습니다.")

    # ── 4. 대표 이미지 ─────────────────────────────────────
    if refs:
        first = next((d for d in declared
                      if isinstance(d, dict) and d.get("file") == refs[0]), None)
        kind = str((first or {}).get("kind", ""))
        if "대표" not in kind:
            warnings.append(f"첫 이미지 [{refs[0]}] 가 대표이미지로 표시되어 있지 "
                            f"않습니다. 네이버는 보통 첫 이미지를 섬네일로 씁니다.")

    return {"errors": errors, "warnings": warnings, "files": files,
            "total_mb": total_mb, "total_text": size_text(total_bytes),
            "count": len(refs)}
