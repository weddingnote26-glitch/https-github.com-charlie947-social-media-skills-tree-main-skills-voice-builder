# -*- coding: utf-8 -*-
"""폴더와 설정 읽기. 다른 서비스 파일이 모두 여기를 씁니다."""

from __future__ import annotations

import json
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STYLE_PATH = PROJECT_ROOT / "config" / "image_style.json"


def load_style() -> dict:
    """config/image_style.json 을 읽습니다."""
    with open(STYLE_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_env() -> dict:
    """
    .env 를 읽습니다. 환경변수가 있으면 그쪽이 우선입니다.

    값은 화면·로그·깃에 절대 찍지 않습니다.
    """
    env: dict[str, str] = {}
    path = PROJECT_ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("OPENAI_API_KEY", "OPENAI_IMAGE_MODEL"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


def _dir(style: dict, key: str) -> Path:
    p = Path(style["output"][key])
    return p if p.is_absolute() else PROJECT_ROOT / p


def raw_dir(style: dict) -> Path:
    return _dir(style, "raw_dir")


def final_dir(style: dict) -> Path:
    return _dir(style, "final_dir")


def prompt_dir(style: dict) -> Path:
    return _dir(style, "prompt_dir")


def manifest_dir(style: dict) -> Path:
    return _dir(style, "manifest_dir")


def desktop_dir(style: dict) -> tuple[Path, str | None]:
    """
    바탕화면 저장 폴더를 정합니다.

    사양에 적힌 경로는 C:/Users/admin/... 입니다.
    이 PC 에 admin 사용자가 없으면 지금 로그인한 사용자의 바탕화면에 저장하고,
    바뀐 사실을 함께 돌려줍니다. (조용히 다른 곳에 저장하지 않습니다)

    돌려주는 값: (실제 저장 폴더, 안내 문구 또는 None)
    """
    want = Path(style["output"]["desktop_dir"])
    # C:/Users/admin/Desktop/... 에서 사용자 폴더는 위로 두 칸입니다.
    user_home = want.parent.parent
    if user_home.exists():
        return want, None

    fallback = Path(os.path.expandvars("%USERPROFILE%")) / want.parent.name / want.name
    note = (f"사양의 저장 폴더 {want} 는 이 PC 에 없습니다"
            f"({user_home} 없음). 대신 {fallback} 에 저장했습니다.")
    return fallback, note


def ensure_dirs(style: dict) -> None:
    for fn in (raw_dir, final_dir, prompt_dir, manifest_dir):
        fn(style).mkdir(parents=True, exist_ok=True)
    desktop_dir(style)[0].mkdir(parents=True, exist_ok=True)
