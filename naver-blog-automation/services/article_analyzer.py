# -*- coding: utf-8 -*-
"""
본문 분석 — 이미지에 넣을 '한 가지 메시지' 를 뽑습니다.

이미 만들어 둔 scripts/infographic.py 의 분석기를 그대로 씁니다.
같은 규칙을 두 곳에 적어 두면 한쪽만 고쳐져서 어긋나기 때문입니다.

돌려주는 값(dict)
    kind      비교형/3단 요약형/흐름형/비유형/차트 교육형 중 하나의 영문 키
    title     이미지 제목 (12~24자)
    points    핵심 2~4개
    footer    바닥 한 줄
    slug      파일 이름에 쓸 영문 키워드
    authored  True = 원고가 직접 지정한 문구, False = 자동 초안
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

from .paths import PROJECT_ROOT

sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
import infographic as _ig      # noqa: E402


KIND_KO = _ig.KIND_KO
KINDS = tuple(_ig.DRAWERS)


def _slug_from(title: str, fallback: str) -> str:
    """제목에서 파일명에 쓸 영문 키워드를 만듭니다."""
    ascii_only = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")
    return (ascii_only or fallback)[:28]


def analyze_article(article_text: str = "",
                    article_title: str = "",
                    post_md: Path | None = None) -> dict:
    """
    원고를 분석합니다.

    post_md 를 주면 그 파일을 읽습니다.
    없으면 article_text 를 임시 파일로 만들어 같은 분석기에 넘깁니다.
    """
    if post_md is not None:
        spec = _ig.analyze(Path(post_md))
    else:
        head = f"---\ntitle: '{article_title}'\n---\n" if article_title else ""
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False,
                                         encoding="utf-8") as f:
            f.write(head + article_text)
            tmp = Path(f.name)
        try:
            spec = _ig.analyze(tmp)
        finally:
            tmp.unlink(missing_ok=True)

    slug = spec.topic_slug
    if slug in ("", "infographic"):
        slug = _slug_from(article_title or spec.title, "blog_image")

    return {
        "kind": spec.kind,
        "kind_ko": KIND_KO[spec.kind],
        "title": spec.title,
        "points": list(spec.points),
        "footer": spec.footer,
        "left_label": spec.left_label,
        "right_label": spec.right_label,
        "left_items": list(spec.left_items),
        "right_items": list(spec.right_items),
        "slug": slug,
        "authored": spec.authored,
        "_spec": spec,          # Pillow 대체 그리기에 그대로 씁니다
    }
