# -*- coding: utf-8 -*-
"""
블로그 이미지 자동 생성 서비스.

역할을 셋으로 나눕니다.

  Claude Code (이 코드)  : 본문 분석 · 프롬프트 작성 · API 호출 제어 · 파일 저장
  OpenAI Image API       : 실제 그림 생성
  네이버 블로그 자동화    : 저장된 JPEG 를 불러와 본문에 넣고 올리기

ChatGPT 웹사이트를 사람처럼 클릭하거나 화면을 캡처하는 방식은 쓰지 않습니다.
"""

from .article_analyzer import analyze_article           # noqa: F401
from .openai_image_service import (                     # noqa: F401
    ImageApiError,
    build_prompt,
    generate_image,
)
from .image_postprocess import to_final_jpeg, unique_path   # noqa: F401
from .image_pipeline import generate_blog_image             # noqa: F401
from .blog_uploader import find_existing_image, image_for_article  # noqa: F401

__all__ = [
    "analyze_article",
    "ImageApiError",
    "build_prompt",
    "generate_image",
    "to_final_jpeg",
    "unique_path",
    "generate_blog_image",
    "find_existing_image",
    "image_for_article",
]
