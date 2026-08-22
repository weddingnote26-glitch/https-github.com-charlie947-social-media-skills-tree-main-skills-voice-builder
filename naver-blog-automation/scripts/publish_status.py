# -*- coding: utf-8 -*-
"""
발행 결과 확인 — 이번 주 12편이 지금 어떤 상태인지 한눈에 봅니다.

실행:  python scripts/publish_status.py [--week 2026-W36] [--mark-published <게시물ID> --url <주소>]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c  # noqa: E402

MARK = {
    "draft": "□ 초안",
    "fact_checked": "◑ 사실확인",
    "reviewed": "◕ 검수완료",
    "approved": "● 승인됨",
    "scheduled": "◆ 예약등록",
    "published": "★ 발행됨",
}


def collect(wdir: Path) -> list[dict]:
    rows = []
    for meta_path in sorted(wdir.rglob("metadata.yaml")):
        meta = c.read_yaml(meta_path, default={}) or {}
        pdir = meta_path.parent
        rows.append({
            "post_id": meta.get("post_id", pdir.name),
            "channel": (meta.get("channel") or {}).get("name", pdir.parent.parent.name),
            "blog_id": (meta.get("channel") or {}).get("blog_id", ""),
            "date": (meta.get("publish") or {}).get("date", pdir.name),
            "time": (meta.get("publish") or {}).get("time", ""),
            "title": meta.get("title") or "(제목 없음)",
            "status": meta.get("status", "draft"),
            "has_post": (pdir / "post.md").exists(),
            "url": (meta.get("published") or {}).get("post_url"),
            "dir": pdir,
        })
    rows.sort(key=lambda r: (r["date"], r["time"]))
    return rows


def mark_published(wdir: Path, post_id: str, url: str | None) -> None:
    for meta_path in wdir.rglob("metadata.yaml"):
        meta = c.read_yaml(meta_path, default={}) or {}
        if meta.get("post_id") != post_id:
            continue
        now = c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST")
        meta["status"] = "published"
        meta.setdefault("published", {}).update({
            "confirmed": True, "confirmed_at": now, "post_url": url,
        })
        meta.setdefault("history", []).append({
            "status": "published", "at": now, "by": "사용자",
            "note": f"발행 확인{' — ' + url if url else ''}",
        })
        c.write_yaml(meta_path, meta)
        c.ok(f"{post_id} — 발행됨으로 표시했습니다.")
        return
    c.warn(f"{post_id} 를 찾지 못했습니다.")


def main() -> None:
    ap = argparse.ArgumentParser(description="이번 주 게시물 상태를 봅니다.")
    ap.add_argument("--week")
    ap.add_argument("--mark-published", metavar="게시물ID")
    ap.add_argument("--url", help="발행된 글 주소")
    args = ap.parse_args()

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)

    if args.mark_published:
        mark_published(wdir, args.mark_published, args.url)
        return

    rows = collect(wdir)
    c.header(f"{wdir.name} 상태 ({len(rows)}편)")

    if not rows:
        c.warn("이 주차에는 게시물이 없습니다.")
        return

    c.say()
    c.say(f"  발행일      {c.pad('시간',5)}  {c.pad('채널',22)}  "
          f"{c.pad('상태',12)}  제목")
    c.say("  " + "─" * 92)
    cur_date = None
    for r in rows:
        if r["date"] != cur_date:
            cur_date = r["date"]
        c.say(f"  {r['date']}  {c.pad(r['time'], 5)}  "
              f"{c.pad(c.clip(r['channel'], 22), 22)}  "
              f"{c.pad(MARK.get(r['status'], r['status']), 12)}  "
              f"{c.clip(r['title'], 34)}")

    c.say()
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    parts = [f"{c.STATUS_KO.get(k, k)} {v}편"
             for k, v in sorted(counts.items(), key=lambda x: c.status_index(x[0]))]
    c.say("  요약: " + " · ".join(parts))

    nxt = {
        "draft": "원고 쓰기        →  python scripts/generate_week.py",
        "fact_checked": "검수             →  python scripts/review.py",
        "reviewed": "승인             →  python scripts/approve.py",
        "approved": "예약 발행 준비   →  python scripts/prepare_publish.py",
        "scheduled": "발행 확인        →  네이버에서 확인 후 --mark-published 로 기록",
    }
    lowest = min((r["status"] for r in rows), key=c.status_index)
    if lowest in nxt:
        c.say()
        c.say(f"  다음 단계: {nxt[lowest]}")


if __name__ == "__main__":
    main()
