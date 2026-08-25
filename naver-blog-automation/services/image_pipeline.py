# -*- coding: utf-8 -*-
"""
이미지 생성 전체 흐름.

  본문 분석 → 프롬프트 작성 → OpenAI Image API 호출 → 원본 저장
  → JPEG 변환 → 최종 저장 → 바탕화면 복사 → 메타데이터 기록 → 경로 반환

아래 여섯 가지가 모두 성공해야 "완료" 입니다. 하나라도 실패하면 success=False 입니다.
  API 호출 · 이미지 수신 · 원본 저장 · JPEG 변환 · 최종 저장 · 경로 확인
"""

from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path

from .article_analyzer import analyze_article
from .image_postprocess import (copy_to, save_raw, to_final_jpeg, unique_path,
                                verify_jpeg)
from .openai_image_service import (ImageApiError, build_prompt, generate_image,
                                   save_prompt)
from .paths import (desktop_dir, ensure_dirs, final_dir, load_style,
                    manifest_dir, prompt_dir, raw_dir)

# Windows 에는 tzdata 가 없을 수 있어 고정 시차를 씁니다. (다른 코드와 같은 방식)
KST = _dt.timezone(_dt.timedelta(hours=9), "KST")


def _now() -> _dt.datetime:
    return _dt.datetime.now(KST)


def _pillow_bytes(spec_obj) -> bytes:
    """
    대체 그리기. OpenAI 를 쓸 수 없을 때만 씁니다.

    한글이 확실하게 정확한 대신 그림 표현은 단순합니다.
    """
    import io
    import sys

    from .paths import PROJECT_ROOT
    sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
    import infographic as ig      # noqa: E402

    im = ig.DRAWERS[spec_obj.kind](spec_obj)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def generate_blog_image(article_text: str = "",
                        article_id: str = "",
                        article_title: str = "",
                        post_md: Path | None = None,
                        engine: str = "openai",
                        dry_run: bool = False) -> dict:
    """
    블로그 본문 하나에 들어갈 이미지 한 장을 만듭니다.

    engine
        "openai"  공식 API 만 씁니다. 실패하면 실패로 보고합니다. (기본값)
        "auto"    API 가 안 되면 Pillow 로 그려서라도 파일을 만듭니다.
        "pillow"  API 를 쓰지 않고 이 PC 에서 그립니다.

    dry_run 이면 프롬프트만 만들어 저장하고 API 를 부르지 않습니다.
    """
    style = load_style()
    ensure_dirs(style)
    stamp = _now().strftime("%Y%m%d")
    started = _now().isoformat(timespec="seconds")

    result: dict = {
        "success": False,
        "article_id": article_id or f"{stamp}_000",
        "topic": "",
        "image_path": "",
        "storage_path": "",
        "format": "JPEG",
        "status": "FAILED",
        "engine": engine,
        "steps": {},
        "notes": [],
        "error": "",
    }

    # ── 1. 본문 분석 ────────────────────────────────────────
    try:
        spec = analyze_article(article_text, article_title, post_md)
    except Exception as exc:                       # noqa: BLE001
        result["error"] = f"본문 분석 실패: {exc}"
        return result
    result["steps"]["본문 분석"] = True
    result["topic"] = spec["slug"]
    result["title"] = spec["title"]
    result["kind"] = spec["kind"]
    result["kind_ko"] = spec["kind_ko"]
    if not spec["authored"]:
        result["notes"].append(
            "문구가 자동 초안입니다. post.md 앞머리에 infographic: 블록을 넣으면 "
            "이미지 문구를 직접 정할 수 있습니다.")

    # ── 2. 프롬프트 ────────────────────────────────────────
    prompt = build_prompt(spec, style)
    ppath = save_prompt(prompt, prompt_dir(style), spec["slug"], stamp)
    result["steps"]["프롬프트 작성"] = True
    result["prompt_path"] = str(ppath)

    if dry_run:
        result["status"] = "DRY_RUN"
        result["notes"].append("dry-run 이라 API 를 부르지 않았습니다.")
        return result

    # ── 3. 이미지 받기 ─────────────────────────────────────
    data: bytes | None = None
    if engine in ("openai", "auto"):
        try:
            data, info = generate_image(prompt, style)
            result["steps"]["API 호출"] = True
            result["steps"]["이미지 수신"] = True
            result["model"] = info["model"]
            result["request_size"] = info["size"]
        except ImageApiError as exc:
            result["steps"]["API 호출"] = False
            result["error"] = str(exc)
            if engine == "openai":
                return result
            result["notes"].append(f"OpenAI 호출이 안 되어 이 PC 에서 그렸습니다. ({exc.args[0].splitlines()[0]})")
            result["engine"] = "pillow(대체)"

    if data is None:
        try:
            data = _pillow_bytes(spec["_spec"])
        except Exception as exc:                   # noqa: BLE001
            result["error"] = f"대체 그리기도 실패했습니다: {exc}"
            return result
        result["steps"]["이미지 수신"] = True
        if engine == "pillow":
            result["engine"] = "pillow"

    # ── 4. 원본 저장 ───────────────────────────────────────
    try:
        raw_path = save_raw(data, raw_dir(style), f"{stamp}_{spec['slug']}")
    except Exception as exc:                       # noqa: BLE001
        result["error"] = f"원본 저장 실패: {exc}"
        return result
    result["steps"]["원본 저장"] = True
    result["raw_path"] = str(raw_path)

    # ── 5. JPEG 변환 + 최종 저장 ───────────────────────────
    try:
        final_path = unique_path(final_dir(style), f"{stamp}_{spec['slug']}")
        to_final_jpeg(raw_path, final_path, style)
    except Exception as exc:                       # noqa: BLE001
        result["error"] = f"JPEG 변환 실패: {exc}"
        return result
    result["steps"]["JPEG 변환"] = True

    problems = verify_jpeg(final_path, style)
    if problems:
        result["error"] = "최종 파일 확인 실패: " + " / ".join(problems)
        return result
    result["steps"]["최종 저장"] = True
    result["storage_path"] = str(final_path)

    # ── 6. 바탕화면 복사 ───────────────────────────────────
    dsk, note = desktop_dir(style)
    if note:
        result["notes"].append(note)
    try:
        desk_path = copy_to(final_path, dsk)
    except Exception as exc:                       # noqa: BLE001
        result["error"] = f"바탕화면 복사 실패: {exc}"
        return result
    if not desk_path.exists():
        result["error"] = f"바탕화면 파일을 찾지 못했습니다: {desk_path}"
        return result
    result["steps"]["경로 확인"] = True
    result["image_path"] = str(desk_path)

    # ── 7. 메타데이터 ──────────────────────────────────────
    meta = {
        "article_id": result["article_id"],
        "article_title": article_title,
        "topic": spec["slug"],
        "image_title": spec["title"],
        "kind": spec["kind"],
        "kind_ko": spec["kind_ko"],
        "points": spec["points"],
        "footer": spec["footer"],
        "text_source": "원고 지정" if spec["authored"] else "자동 초안",
        "engine": result["engine"],
        "model": result.get("model", ""),
        "request_size": result.get("request_size", ""),
        "prompt_path": str(ppath),
        "raw_path": str(raw_path),
        "storage_path": str(final_path),
        "image_path": str(desk_path),
        "format": "JPEG",
        "quality": style["canvas"]["quality"],
        "size": [style["canvas"]["width"], style["canvas"]["height"]],
        "started_at_kst": started,
        "finished_at_kst": _now().isoformat(timespec="seconds"),
    }
    mpath = unique_path(manifest_dir(style), f"{stamp}_{spec['slug']}", ".json")
    mpath.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    result["manifest_path"] = str(mpath)

    result["success"] = True
    result["status"] = "READY"
    return result
