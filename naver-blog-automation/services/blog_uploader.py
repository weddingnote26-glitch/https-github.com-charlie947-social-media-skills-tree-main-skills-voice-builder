# -*- coding: utf-8 -*-
"""
네이버 블로그 자동화와 잇는 부분.

올리는 단계에서는 이미지를 **다시 만들지 않습니다.**
먼저 저장소에서 article_id 또는 topic 에 맞는 JPEG 를 찾고,
없을 때만 새로 만듭니다. 만들기와 올리기를 분리하기 위한 규칙입니다.

이 파일은 파일 경로만 돌려줍니다. 실제 발행은 하지 않습니다.
"""

from __future__ import annotations

import json
from pathlib import Path

from .paths import final_dir, load_style, manifest_dir


def _manifests(style: dict) -> list[dict]:
    out: list[dict] = []
    for p in sorted(manifest_dir(style).glob("*.json")):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


def find_existing_image(article_id: str = "", topic: str = "",
                        style: dict | None = None) -> Path | None:
    """
    이미 만들어 둔 최종 JPEG 를 찾습니다.

    1) 메타데이터에서 article_id 가 같은 것
    2) 메타데이터에서 topic 이 같은 것
    3) 파일 이름에 topic 이 들어간 것

    같은 것이 여럿이면 가장 최근 파일을 씁니다.
    """
    style = style or load_style()

    def _alive(rec: dict) -> Path | None:
        p = Path(rec.get("storage_path", ""))
        return p if p.exists() else None

    if article_id:
        hits = [q for r in _manifests(style)
                if r.get("article_id") == article_id and (q := _alive(r))]
        if hits:
            return max(hits, key=lambda p: p.stat().st_mtime)

    if topic:
        hits = [q for r in _manifests(style)
                if r.get("topic") == topic and (q := _alive(r))]
        if hits:
            return max(hits, key=lambda p: p.stat().st_mtime)

        loose = [p for p in final_dir(style).glob(f"*{topic}*.jpg")]
        if loose:
            return max(loose, key=lambda p: p.stat().st_mtime)

    return None


def image_for_article(article_text: str = "", article_id: str = "",
                      article_title: str = "", post_md: Path | None = None,
                      engine: str = "openai", reuse: bool = True) -> dict:
    """
    블로그 업로드용 이미지 경로를 돌려줍니다.

    reuse=True 이면 저장소에 있는 파일을 그대로 씁니다. (기본값)
    없으면 그때 OpenAI Image API 로 새로 만듭니다.
    """
    style = load_style()
    if reuse:
        found = find_existing_image(article_id, "", style)
        if found is not None:
            return {
                "success": True,
                "article_id": article_id,
                "storage_path": str(found),
                "image_path": str(found),
                "format": "JPEG",
                "status": "REUSED",
                "notes": ["저장소에 있던 파일을 그대로 씁니다. 새로 만들지 않았습니다."],
            }

    from .image_pipeline import generate_blog_image
    return generate_blog_image(article_text=article_text, article_id=article_id,
                               article_title=article_title, post_md=post_md,
                               engine=engine)
