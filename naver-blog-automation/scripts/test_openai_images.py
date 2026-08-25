# -*- coding: utf-8 -*-
"""
OpenAI 이미지 생성 계층 검사 — 인터넷 없이 돕니다.

실제 API 는 부르지 않습니다. 대신 이런 것을 확인합니다.
  · 프롬프트에 사양의 색·규격·문구가 빠짐없이 들어가는가
  · 본문을 그대로 복사하지 않는가
  · 키가 오류 메시지에 새지 않는가
  · JPEG 규격·이름 중복·저장 폴더 대체가 규칙대로인가
  · 키가 없을 때 "완료" 라고 하지 않는가

실행:  npm run test:images:ai
"""

from __future__ import annotations

import io
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from PIL import Image                                     # noqa: E402

from services import article_analyzer, blog_uploader      # noqa: E402
from services import image_postprocess as post            # noqa: E402
from services import openai_image_service as svc          # noqa: E402
from services import paths                                # noqa: E402
from services.image_pipeline import generate_blog_image   # noqa: E402

_ok = 0
_bad: list[str] = []


def check(label: str, cond: bool) -> None:
    global _ok
    if cond:
        _ok += 1
        print(f"  ✅ {label}")
    else:
        _bad.append(label)
        print(f"  ❌ {label}")


STYLE = paths.load_style()

SPEC = {
    "kind": "three",
    "title": "월요일 아침에 볼 숫자 셋",
    "points": ["코스피와 코스닥 지수", "달러 대비 원화 환율", "지난주와 견주어 보기"],
    "footer": "숫자보다 방향을 보세요",
    "left_label": "", "right_label": "", "left_items": [], "right_items": [],
}


def main() -> int:
    print()
    print("  OpenAI 이미지 계층 검사")
    print("  " + "─" * 56)

    # ── 1. 프롬프트 ────────────────────────────────────────
    p = svc.build_prompt(SPEC, STYLE)
    check("프롬프트에 규격 1200x1500 이 있다", "1200x1500" in p)
    check("프롬프트에 4:5 가 있다", "4:5" in p)
    for name, hexv in STYLE["colors"].items():
        if name.startswith("_"):
            continue
        if not isinstance(hexv, str):
            continue
        if hexv not in p:
            check(f"프롬프트에 색 {name} 이 있다", False)
            break
    else:
        check("프롬프트에 여섯 가지 색이 모두 있다", True)
    check("프롬프트에 제목이 그대로 들어간다", SPEC["title"] in p)
    check("프롬프트에 포인트 3개가 모두 들어간다",
          all(x in p for x in SPEC["points"]))
    check("프롬프트에 바닥 문구가 들어간다", SPEC["footer"] in p)
    check("프롬프트에 금지 항목이 들어간다", "실제 종목 이름" in p)
    check("프롬프트에 5070 안내가 들어간다", "5070" in p)
    check("프롬프트가 한 메시지 원칙을 적는다", "한 가지 메시지" in p)

    body = "이것은 본문 문단입니다. " * 40
    p2 = svc.build_prompt({**SPEC, "points": SPEC["points"]}, STYLE)
    check("프롬프트가 본문을 그대로 옮기지 않는다", body[:60] not in p2)
    check("프롬프트 길이가 지나치게 길지 않다", len(p2) < 3000)

    # ── 2. 키 가리기 ───────────────────────────────────────
    m = svc.mask_secrets("Authorization: Bearer sk-abcd1234efgh5678ijkl")
    check("Bearer 키를 가린다", "abcd1234" not in m)
    m2 = svc.mask_secrets("api_key=ABCDEFGHIJKLMNOP1234567890")
    check("api_key= 값을 가린다", "ABCDEFGH" not in m2)
    m3 = svc.mask_secrets("HTTP 401 Incorrect API key provided: sk-proj-XYZ9876543210abcdefgh")
    check("오류 메시지 안의 키를 가린다", "XYZ9876543210" not in m3)
    check("가린 뒤에도 상태 코드는 남는다", "401" in m3)

    # ── 3. 파일 이름·규격 ──────────────────────────────────
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        a = post.unique_path(d, "20260824_test")
        a.write_bytes(b"x")
        b = post.unique_path(d, "20260824_test")
        check("이름이 겹치면 _01 을 붙인다", b.name == "20260824_test_01.jpg")
        b.write_bytes(b"x")
        c = post.unique_path(d, "20260824_test")
        check("두 번 겹치면 _02 를 붙인다", c.name == "20260824_test_02.jpg")

        # 1024x1536(2:3) 을 1200x1500(4:5) 으로
        src = Image.new("RGB", (1024, 1536), (11, 42, 85))
        buf = io.BytesIO()
        src.save(buf, "PNG")
        out = post.to_final_jpeg(buf.getvalue(), d / "conv.jpg", STYLE)
        with Image.open(out) as im:
            check("2:3 을 1200x1500 으로 맞춘다", im.size == (1200, 1500))
            check("RGB 로 저장한다", im.mode == "RGB")
            check("JPEG 로 저장한다", im.format == "JPEG")
        check("변환 결과가 규격 검사를 통과한다", post.verify_jpeg(out, STYLE) == [])

        # 규격이 틀리면 잡아내는지
        Image.new("RGB", (800, 600)).save(d / "wrong.jpg", "JPEG")
        check("규격이 다르면 잡아낸다",
              any("규격" in x for x in post.verify_jpeg(d / "wrong.jpg", STYLE)))
        check("파일이 없으면 잡아낸다",
              post.verify_jpeg(d / "없는파일.jpg", STYLE) != [])

    # ── 4. 저장 폴더 대체 ──────────────────────────────────
    dsk, note = paths.desktop_dir(STYLE)
    want = Path(STYLE["output"]["desktop_dir"])
    if want.parent.parent.exists():
        check("사양 폴더가 있으면 그대로 쓴다", dsk == want and note is None)
    else:
        check("사양 폴더가 없으면 다른 곳에 쓰고 알린다",
              dsk != want and note is not None and str(want) in note)
        check("대체 폴더 이름은 그대로 유지한다", dsk.name == want.name)

    # ── 5. 키가 없을 때 ────────────────────────────────────
    real = paths.load_env
    paths.load_env = lambda: {}
    svc.load_env = lambda: {}
    try:
        try:
            svc.generate_image("테스트", STYLE)
            check("키가 없으면 오류를 낸다", False)
        except svc.ImageApiError as exc:
            check("키가 없으면 오류를 낸다", True)
            check("오류 메시지가 한국어 안내다", "OPENAI_API_KEY" in str(exc)
                  and ".env" in str(exc))

        md = PROJECT_ROOT / "output" / "2026-W35" / "stock" / "2026-08-24" / "post.md"
        if md.exists():
            r = generate_blog_image(post_md=md, article_id="테스트", engine="openai")
            check("키가 없으면 성공이라고 하지 않는다", r["success"] is False)
            check("상태가 FAILED 다", r["status"] == "FAILED")
            check("어느 단계에서 막혔는지 적는다", r["steps"].get("API 호출") is False)
            check("경로를 비워 둔다", r["image_path"] == "")

            r2 = generate_blog_image(post_md=md, article_id="테스트", dry_run=True)
            check("dry-run 은 API 를 부르지 않는다", r2["status"] == "DRY_RUN")
            check("dry-run 도 프롬프트는 남긴다",
                  Path(r2["prompt_path"]).exists())
    finally:
        paths.load_env = real
        svc.load_env = real

    # ── 6. 본문 분석 ───────────────────────────────────────
    md = PROJECT_ROOT / "output" / "2026-W35" / "stock" / "2026-08-24" / "post.md"
    if md.exists():
        s = article_analyzer.analyze_article(post_md=md)
        check("분석 결과에 유형이 있다", s["kind"] in article_analyzer.KINDS)
        check("제목이 24자 이내다", 0 < len(s["title"]) <= 24)
        check("포인트가 2~4개다", 2 <= len(s["points"]) <= 4)
        check("슬러그가 영문·숫자다",
              s["slug"].replace("_", "").isalnum() and s["slug"].isascii())

    # ── 7. 재사용 ──────────────────────────────────────────
    check("없는 글은 못 찾았다고 한다",
          blog_uploader.find_existing_image(article_id="있을리없는값") is None)

    print("  " + "─" * 56)
    if _bad:
        print(f"  ❌ {len(_bad)}개 실패 / {_ok + len(_bad)}개 중")
        for b in _bad:
            print(f"      - {b}")
        print()
        return 1
    print(f"  ✅ {_ok}개 전부 통과")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
