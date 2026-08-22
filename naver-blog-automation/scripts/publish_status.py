# -*- coding: utf-8 -*-
"""
상태 보기와 단계 기록

  이번 주 글이 지금 어디까지 갔는지 한눈에 봅니다.
  네이버에서 한 단계를 마칠 때마다 여기에 기록해 두면
  중간에 멈췄다가 다시 시작할 때 어디부터 하면 되는지 알 수 있습니다.

실행
  python scripts/publish_status.py
  python scripts/publish_status.py --set draft_saved --post <게시물ID>
  python scripts/publish_status.py --set post_publish_verified --post <ID> --url <주소>
  python scripts/publish_status.py --fail --post <ID> --note "로그인이 풀렸음"
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c  # noqa: E402

# 네이버 글 주소에서 게시물 번호를 뽑습니다.
#   https://blog.naver.com/playorak/224385284287
LOGNO_RE = re.compile(r"blog\.naver\.com/[^/]+/(\d+)")

# 사람이 손으로 기록하는 단계들
MANUAL_STEPS = [
    "editor_filled", "draft_saved",
    "reservation_requested", "reservation_verified",
    "published", "post_publish_verified",
]


def collect(wdir: Path) -> list[dict]:
    rows = []
    for meta_path in sorted(wdir.rglob("metadata.yaml")):
        meta = c.read_yaml(meta_path, default={}) or {}
        pdir = meta_path.parent
        pub = meta.get("publish") or {}
        rows.append({
            "post_id": meta.get("post_id", pdir.name),
            "channel": (meta.get("channel") or {}).get("name", pdir.parent.name),
            "blog_id": (meta.get("channel") or {}).get("blog_id", ""),
            "date": pub.get("date", pdir.name),
            "time": pub.get("time", ""),
            "title": meta.get("title") or "(제목 없음)",
            "status": meta.get("status", "draft"),
            "url": (meta.get("published") or {}).get("post_url"),
            "note": (meta.get("failure") or {}).get("note"),
            "dir": pdir,
        })
    rows.sort(key=lambda r: (r["date"], r["time"]))
    return rows


def find_post(wdir: Path, post_id: str) -> Path | None:
    for meta_path in wdir.rglob("metadata.yaml"):
        meta = c.read_yaml(meta_path, default={}) or {}
        if meta.get("post_id") == post_id:
            return meta_path.parent
    return None


def record(pdir: Path, new_status: str, url: str | None,
           note: str, who: str, force: bool) -> bool:
    meta_path = pdir / "metadata.yaml"
    meta = c.read_yaml(meta_path, default={}) or {}
    cur = meta.get("status", "draft")
    pid = meta.get("post_id")
    now = c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST")

    # ── 실패 기록 ─────────────────────────────────────────
    if new_status == "failed":
        meta["status"] = "failed"
        meta["failure"] = {"at": now, "from_status": cur, "note": note or "", "by": who}
        meta.setdefault("history", []).append({
            "status": "failed", "at": now, "by": who,
            "note": note or f"{c.STATUS_KO.get(cur, cur)} 단계에서 멈춤",
        })
        c.write_yaml(meta_path, meta)
        c.warn(f"{pid} — 실패로 기록했습니다. ({c.STATUS_KO.get(cur, cur)} 단계)")
        if note:
            c.say(f"      사유: {note}")
        c.say(f"      고친 뒤 이어서 하려면:  --set {cur} --post {pid}")
        return True

    # ── 승인 전에는 네이버 단계로 갈 수 없습니다 ──────────
    if new_status in MANUAL_STEPS and not c.can_touch_naver(cur) and cur != "failed":
        c.error(
            f"{pid} — 아직 네이버 작업 단계가 아닙니다.\n"
            f"      지금 상태: {c.STATUS_KO.get(cur, cur)}\n"
            f"      승인부터 받아 주세요:  python scripts/approve.py --post {pid}"
        )
        return False

    # ── 순서 지키기 ───────────────────────────────────────
    if not force and cur != "failed":
        if c.status_index(new_status) <= c.status_index(cur):
            c.info(f"{pid} — 이미 {c.STATUS_KO.get(cur, cur)} 상태입니다. "
                   f"그대로 둡니다.")
            return False
        if not c.can_advance(cur, new_status):
            skipped = c.STATUSES[c.status_index(cur) + 1:c.status_index(new_status)]
            c.error(
                f"{pid} — 단계를 건너뛸 수 없습니다.\n"
                f"      지금: {c.STATUS_KO.get(cur, cur)}"
                f"  →  하려는 것: {c.STATUS_KO.get(new_status, new_status)}\n"
                f"      빠진 단계: "
                f"{', '.join(c.STATUS_KO.get(s, s) for s in skipped)}\n"
                f"      순서대로 기록해 주세요. (정말 건너뛰려면 --force)"
            )
            return False

    meta["status"] = new_status
    meta.pop("failure", None)

    if url:
        m = LOGNO_RE.search(url)
        meta.setdefault("published", {})["post_url"] = url
        if m:
            meta["published"]["naver_log_no"] = m.group(1)
            meta["naver_log_no"] = m.group(1)

    stamp = {
        "editor_filled":         ("package", "editor_filled_at"),
        "draft_saved":           ("package", "draft_saved_at"),
        "reservation_requested": ("scheduled", "requested_at"),
        "reservation_verified":  ("scheduled", "verified_at"),
        "published":             ("published", "confirmed_at"),
        "post_publish_verified": ("published", "verified_at"),
    }.get(new_status)
    if stamp:
        meta.setdefault(stamp[0], {})[stamp[1]] = now
    if new_status == "reservation_verified":
        meta.setdefault("scheduled", {})["registered"] = True
    if new_status in ("published", "post_publish_verified"):
        meta.setdefault("published", {})["confirmed"] = True

    meta.setdefault("history", []).append({
        "status": new_status, "at": now, "by": who, "note": note or "",
    })
    c.write_yaml(meta_path, meta)

    # publish/result.json 도 함께 갱신
    rpath = pdir / "publish" / "result.json"
    if rpath.exists():
        res = c.read_json(rpath, default={}) or {}
        res.setdefault("steps", {})[new_status] = now
        if url:
            res["post_url"] = url
            m = LOGNO_RE.search(url)
            if m:
                res["naver_log_no"] = m.group(1)
        c.write_json(rpath, res)

    c.ok(f"{pid} — {c.STATUS_KO.get(new_status, new_status)} 로 기록했습니다.")
    nxt = c.STATUSES[c.status_index(new_status) + 1:]
    if nxt:
        c.say(f"      다음 단계: {c.STATUS_KO.get(nxt[0], nxt[0])}")
    else:
        c.say("      모든 단계를 마쳤습니다.")
    c.get_logger().info(f"상태 기록: {pid} → {new_status}")
    return True


def show(wdir: Path) -> None:
    rows = collect(wdir)
    c.header(f"{wdir.name} 상태 ({len(rows)}편)")
    if not rows:
        c.warn("이 주차에는 게시물이 없습니다.")
        return

    c.say()
    c.say(f"  발행일      {c.pad('시간', 5)}  {c.pad('채널', 22)}  "
          f"{c.pad('상태', 16)}  제목")
    c.say("  " + "─" * 96)
    for r in rows:
        mark = c.STATUS_MARK.get(r["status"], "?")
        label = f"{mark} {c.STATUS_KO.get(r['status'], r['status'])}"
        c.say(f"  {r['date']}  {c.pad(r['time'], 5)}  "
              f"{c.pad(c.clip(r['channel'], 22), 22)}  "
              f"{c.pad(label, 16)}  {c.clip(r['title'], 30)}")
        if r["status"] == "failed" and r["note"]:
            c.say(f"  {' ' * 12}└ 사유: {r['note']}")

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    order = {s: i for i, s in enumerate(c.STATUSES)}
    parts = [f"{c.STATUS_KO.get(k, k)} {v}편"
             for k, v in sorted(counts.items(), key=lambda x: order.get(x[0], 99))]
    c.say()
    c.say("  요약: " + " · ".join(parts))

    nxt = {
        "draft":                 "원고 쓰기      →  python scripts/generate_week.py",
        "fact_checked":          "검수          →  python scripts/review.py",
        "reviewed":              "승인          →  python scripts/approve.py",
        "approved":              "발행 준비      →  python scripts/prepare_publish.py",
        "editor_filled":         "비공개 저장    →  네이버에서 저장 후 --set draft_saved",
        "draft_saved":           "예약 걸기      →  네이버에서 예약 후 --set reservation_requested",
        "reservation_requested": "예약 확인      →  예약 목록 확인 후 --set reservation_verified",
        "reservation_verified":  "발행일 기다리기 →  발행 후 --set published",
        "published":             "발행 확인      →  글을 열어 확인 후 --set post_publish_verified",
    }
    active = [r["status"] for r in rows if r["status"] != "failed"]
    if active:
        lowest = min(active, key=lambda s: order.get(s, 99))
        if lowest in nxt:
            c.say()
            c.say(f"  다음 단계: {nxt[lowest]}")
    if any(r["status"] == "failed" for r in rows):
        c.say()
        c.warn("실패로 기록된 글이 있습니다. 위의 사유를 확인해 주세요.")


def main() -> None:
    ap = argparse.ArgumentParser(description="게시물 상태를 보거나 기록합니다.")
    ap.add_argument("--week")
    ap.add_argument("--set", dest="new_status", choices=MANUAL_STEPS,
                    help="이 단계를 마쳤다고 기록합니다")
    ap.add_argument("--fail", action="store_true", help="실패로 기록합니다")
    ap.add_argument("--post", help="게시물 ID")
    ap.add_argument("--url", help="네이버 글 주소")
    ap.add_argument("--note", default="", help="메모")
    ap.add_argument("--force", action="store_true", help="단계 건너뛰기 허용")
    # 예전 이름도 계속 받습니다.
    ap.add_argument("--mark-published", metavar="게시물ID", dest="legacy")
    args = ap.parse_args()

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)

    if args.legacy:
        args.post, args.new_status = args.legacy, "published"

    if args.new_status or args.fail:
        if not args.post:
            c.error("--post <게시물ID> 를 함께 적어 주세요.")
            raise SystemExit(1)
        pdir = find_post(wdir, args.post)
        if not pdir:
            c.error(f"게시물을 찾지 못했습니다: {args.post}")
            raise SystemExit(1)
        try:
            who = c.load_settings().get("machine_name", "사용자")
        except c.ConfigError:
            who = "사용자"
        status = "failed" if args.fail else args.new_status
        ok = record(pdir, status, args.url, args.note, who, args.force)
        raise SystemExit(0 if ok else 1)

    show(wdir)


if __name__ == "__main__":
    main()
