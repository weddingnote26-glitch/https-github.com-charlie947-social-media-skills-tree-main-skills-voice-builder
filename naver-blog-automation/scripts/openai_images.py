# -*- coding: utf-8 -*-
"""
블로그 인포그래픽 만들기 — OpenAI 공식 Image API 직접 호출.

  npm run images:ai -- --post output/2026-W35/stock/2026-08-24
  npm run images:ai -- --week output/2026-W35
  npm run images:ai -- --post ... --dry-run      프롬프트만 보고 API 는 안 부름
  npm run images:ai -- --post ... --engine auto  API 가 안 되면 이 PC 에서 그림

ChatGPT 웹사이트를 사람처럼 클릭하거나 화면을 캡처하지 않습니다.
기존 scripts/make_images.py(표·차트 직접 그리기)와는 다른 도구입니다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services import generate_blog_image             # noqa: E402
from services.paths import desktop_dir, load_style   # noqa: E402

LINE = "=" * 46


def _ok_report(r: dict) -> None:
    """성공했을 때. 사양에 적힌 고정 형식 그대로 찍습니다."""
    img = Path(r["image_path"])
    way = ("OpenAI 공식 Image API 직접 호출" if r.get("engine") == "openai"
           else "이 PC 에서 Pillow 로 직접 그림 (OpenAI 안 씀)")
    print()
    print("=" * 34)
    print("이미지 생성 완료")
    print()
    print("주제:")
    print(r.get("title") or r.get("topic", ""))
    print()
    print("생성 방식:")
    print(way)
    if r.get("model"):
        print(f"(모델 {r['model']}, 요청 규격 {r.get('request_size', '')})")
    print()
    print("파일 형식:")
    print(r["format"])
    print()
    print("저장 위치:")
    print(img.parent)
    print()
    print("파일명:")
    print(img.name)
    print()
    print("상태:")
    print(r["status"])
    print("=" * 34)
    for n in r.get("notes", []):
        print(f"  · {n}")
    print()


def _fail_report(r: dict) -> None:
    """실패했거나 dry-run 일 때. 어디서 막혔는지 그대로 적습니다."""
    print()
    print(LINE)
    print()
    print("  프롬프트만 만들었습니다 (API 호출 안 함)"
          if r.get("status") == "DRY_RUN" else "  이미지 생성 실패")
    print()
    print(f"  주제        : {r.get('title') or r.get('topic', '')}")
    print(f"  이미지 유형 : {r.get('kind_ko', '')}")
    if r.get("prompt_path"):
        print(f"  프롬프트    : {r['prompt_path']}")
    print(f"  상태        : {r['status']}")
    print()
    if r.get("steps"):
        print("  단계별 확인")
        for k, ok in r["steps"].items():
            print(f"    {'OK  ' if ok else '실패'}  {k}")
        print()
    for n in r.get("notes", []):
        print(f"  · {n}")
    if r.get("error"):
        print()
        print("  오류")
        for line in str(r["error"]).splitlines():
            print(f"    {line}")
    print()
    print(LINE)
    print()


def _report(r: dict) -> None:
    (_ok_report if r["success"] else _fail_report)(r)


def main() -> int:
    ap = argparse.ArgumentParser(description="블로그 이미지 만들기 (OpenAI Image API)")
    ap.add_argument("--post", help="원고 폴더 (post.md 가 있는 곳)")
    ap.add_argument("--week", help="주차 폴더 — 그 안의 원고를 모두 처리합니다")
    ap.add_argument("--article-id", default="", help="글 번호 (없으면 폴더 이름)")
    ap.add_argument("--engine", choices=("openai", "auto", "pillow"),
                    default="openai", help="기본값 openai")
    ap.add_argument("--dry-run", action="store_true",
                    help="프롬프트만 만들고 API 를 부르지 않습니다")
    args = ap.parse_args()

    if not args.post and not args.week:
        ap.error("--post 또는 --week 중 하나가 필요합니다")

    targets: list[Path] = []
    if args.post:
        p = Path(args.post)
        targets.append(p / "post.md" if p.is_dir() else p)
    if args.week:
        targets += sorted(Path(args.week).glob("*/*/post.md"))

    for t in [t for t in targets if not t.exists()]:
        print(f"  [오류] 원고를 찾지 못했습니다: {t}")
    targets = [t for t in targets if t.exists()]
    if not targets:
        return 1

    dsk, note = desktop_dir(load_style())
    if note:
        print()
        print(f"  [알림] {note}")

    fails = 0
    for md in targets:
        aid = args.article_id or f"{md.parent.parent.name}_{md.parent.name}"
        r = generate_blog_image(article_id=aid, post_md=md,
                                engine=args.engine, dry_run=args.dry_run)
        _report(r)
        if not r["success"] and r.get("status") != "DRY_RUN":
            fails += 1

    if len(targets) > 1:
        print(f"  전체 {len(targets)}건 중 실패 {fails}건")
        print()
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
