# -*- coding: utf-8 -*-
"""
승인 — 사람이 직접 확인하고 승인 도장을 찍는 단계입니다.

  · 검수를 통과한(reviewed) 글만 승인할 수 있습니다.
  · 승인하지 않은 글은 예약 등록으로 넘어가지 않습니다.
  · 승인 날짜와 확인한 사람을 기록으로 남깁니다.

실행:  python scripts/approve.py [--week 2026-W36] [--post <게시물ID>]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts.postfile import PostFile      # noqa: E402


def show_summary(pdir: Path, post: PostFile, meta: dict, ch: dict) -> None:
    """승인 전에 사람이 눈으로 대조할 정보를 보여줍니다."""
    c.say()
    c.say("  ┌──────────────────────────────────────────────────────┐")
    c.say("  │  발행 정보를 확인해 주세요                           │")
    c.say("  └──────────────────────────────────────────────────────┘")
    c.say()
    c.say(f"    채널        : {ch['name']}")
    c.say(f"    블로그 주소 : {ch['url']}")
    c.say(f"    블로그 ID   : {ch['blog_id']}   ← 이 값이 맞는지 꼭 보세요")
    c.say(f"    카테고리    : {meta.get('publish', {}).get('category', '')}")
    c.say(f"    예약 일시   : {post.get('publish_date')} ({post.get('weekday')}) "
          f"{post.get('publish_time')} (한국시간)")
    c.say(f"    공개 범위   : {meta.get('publish', {}).get('visibility', 'closed')}")
    c.say()
    c.say(f"    제목        : {post.get('title')}")
    c.say(f"    해시태그    : {' '.join('#' + t for t in post.hashtags())}")
    c.say(f"    이미지      : {', '.join(post.image_refs()) or '(없음)'}")
    c.say(f"    자료 기준   : {post.get('data_asof') or '해당 없음'}")
    c.say()

    checklist = pdir / "checklist.md"
    if checklist.exists():
        warns = [ln for ln in c.read_text(checklist).splitlines()
                 if ln.startswith("- [") and "] " in ln]
        review = c.read_yaml(pdir / "metadata.yaml", default={}) or {}
        n = (review.get("review") or {}).get("warnings", 0)
        if n:
            c.say(f"    검수에서 '확인' 항목이 {n}건 있습니다. "
                  f"→ {c.rel(checklist)}")
    c.say(f"    원고 파일   : {c.rel(pdir / 'post.md')}")
    c.say(f"    붙여넣기용  : {c.rel(pdir / 'post.html')}")
    c.say(f"    출처 기록   : {c.rel(pdir / 'sources.md')}")
    c.say()


def approve_one(pdir: Path, who: str, assume_yes: bool = False) -> bool:
    meta_path = pdir / "metadata.yaml"
    meta = c.read_yaml(meta_path, default={}) or {}
    status = meta.get("status", "draft")
    ch_key = pdir.parent.name
    ch = c.get_channel(ch_key)
    name = f"{ch['name']} / {pdir.name}"

    if status == "approved":
        c.info(f"{name} — 이미 승인된 글입니다.")
        return False
    if c.status_index(status) > c.status_index("approved"):
        c.info(f"{name} — 이미 {c.STATUS_KO.get(status, status)} 상태입니다.")
        return False
    if status != "reviewed":
        c.warn(
            f"{name} — 아직 승인할 수 없습니다. "
            f"현재 상태: {c.STATUS_KO.get(status, status)}"
        )
        c.say("      검수를 먼저 통과해야 합니다: python scripts/review.py")
        return False

    post = PostFile.load(pdir / "post.md")

    # 채널이 뒤바뀌지 않았는지 마지막으로 한 번 더 확인합니다.
    if str(post.get("blog_id")) != ch["blog_id"]:
        c.error(
            f"{name} — 블로그 ID가 다릅니다. "
            f"원고 「{post.get('blog_id')}」 / 설정 「{ch['blog_id']}」\n"
            f"      채널이 뒤바뀌었을 수 있습니다. 승인하지 않았습니다."
        )
        return False

    show_summary(pdir, post, meta, ch)

    if not assume_yes:
        c.say("    아래 다섯 가지를 직접 확인하셨습니까?")
        c.say("      1) 제목이 내용과 맞는가")
        c.say("      2) 본문 내용에 잘못된 곳이 없는가")
        c.say("      3) 이미지가 준비되었는가")
        c.say("      4) 수치의 출처가 맞는가")
        c.say("      5) 채널과 예약 일시가 맞는가")
        c.say()
        if not c.confirm(f"  이 글을 승인하시겠습니까? [{ch['confirm_phrase']}]"):
            c.info("승인하지 않았습니다.")
            return False

    now = c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST")
    meta["status"] = "approved"
    meta.setdefault("approval", {}).update({
        "approved": True, "approved_at": now, "approved_by": who,
    })
    meta.setdefault("history", []).append({
        "status": "approved", "at": now, "by": who,
        "note": "사람이 확인 후 승인",
    })
    c.write_yaml(meta_path, meta)

    post.front["status"] = "approved"
    post.save()

    c.ok(f"{name} — 승인했습니다. ({now})")
    c.get_logger().info(f"승인: {meta.get('post_id')} by {who}")
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description="검수를 통과한 글을 승인합니다.")
    ap.add_argument("--week")
    ap.add_argument("--post", help="게시물 ID 하나만")
    ap.add_argument("--by", default="", help="승인한 사람 이름")
    ap.add_argument("--yes", action="store_true",
                    help="확인 질문 없이 승인 (권장하지 않습니다)")
    args = ap.parse_args()

    try:
        settings = c.load_settings()
    except c.ConfigError as e:
        c.error(str(e)); raise SystemExit(1)

    who = args.by or settings.get("machine_name") or "사용자"

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)
    c.header(f"{wdir.name} 승인")

    n = 0
    for pm in sorted(wdir.rglob("post.md")):
        pdir = pm.parent
        if args.post:
            meta = c.read_yaml(pdir / "metadata.yaml", default={}) or {}
            if meta.get("post_id") != args.post:
                continue
        if approve_one(pdir, who, args.yes):
            n += 1

    c.say()
    c.ok(f"{n}편을 승인했습니다.")
    if n:
        c.say()
        c.say("  다음 단계:  python scripts/prepare_publish.py")


if __name__ == "__main__":
    main()
