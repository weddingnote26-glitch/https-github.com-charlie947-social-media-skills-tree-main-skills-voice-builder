# -*- coding: utf-8 -*-
"""
네이버 예약 발행 준비

  승인된 글을 대상으로
    1) 중복 발행 위험을 검사하고
    2) 예약 시각 충돌을 검사한 뒤
    3) 네이버 편집기에 그대로 옮길 수 있는 업로드 패키지를 만듭니다.

  검사에서 걸린 글은 패키지를 만들지 않습니다.

실행:  python scripts/prepare_publish.py [--week 2026-W36] [--post <게시물ID>]
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts import conflicts              # noqa: E402
from scripts.build_package import build    # noqa: E402
from scripts.render_html import render     # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="네이버 예약 발행용 자료를 준비합니다.")
    ap.add_argument("--week")
    ap.add_argument("--post", help="게시물 ID 하나만")
    ap.add_argument("--ignore-conflicts", action="store_true",
                    help="충돌 검사에서 걸려도 패키지를 만듭니다 (권장하지 않습니다)")
    args = ap.parse_args()

    try:
        settings = c.load_settings()
    except c.ConfigError as e:
        c.error(str(e)); raise SystemExit(1)

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)
    c.header(f"{wdir.name} 예약 발행 준비")

    ready, blocked, waiting = [], [], []
    seen_ids: dict[str, Path] = {}

    for meta_path in sorted(wdir.rglob("metadata.yaml")):
        pdir = meta_path.parent
        meta = c.read_yaml(meta_path, default={}) or {}
        pid = meta.get("post_id", pdir.name)
        status = meta.get("status", "draft")

        if args.post and pid != args.post:
            continue

        if pid in seen_ids:
            c.error(f"게시물 ID가 중복됩니다: {pid}\n"
                    f"      {c.rel(seen_ids[pid])} / {c.rel(pdir)}")
            raise SystemExit(1)
        seen_ids[pid] = pdir

        if not (pdir / "post.md").exists():
            waiting.append((pid, "원고 없음"))
            continue
        if not c.can_touch_naver(status):
            waiting.append((pid, c.STATUS_KO.get(status, status)))
            continue

        # ── 검사 ───────────────────────────────────────────
        found = conflicts.check_all(pdir, settings)
        issues = found["duplicate"] + found["schedule"]

        if issues and not args.ignore_conflicts:
            blocked.append((pid, issues))
            continue
        if issues:
            c.warn(f"{pid} — 검사에서 걸렸지만 그대로 진행합니다.")
            for i in issues:
                c.say(f"      △ {i}")

        # ── 패키지 만들기 ──────────────────────────────────
        render(pdir)                     # 미리보기용 HTML (붙여넣기용 아님)
        r = build(pdir, settings)

        img = r["images"]
        if img["errors"]:
            c.warn(f"{pid} — 이미지에 문제가 있습니다.")
            for e in img["errors"]:
                c.say(f"      ✗ {e}")
        else:
            c.ok(f"{pid} — 블록 {r['blocks']}개 · "
                 f"이미지 {img['count']}장({img['total_text']})")
        for w in img["warnings"]:
            c.say(f"      △ {w}")

        pub = meta.get("publish") or {}
        ch = c.get_channel(pdir.parent.name)
        ready.append({
            "순서": 0,
            "게시물ID": pid,
            "채널": ch["name"],
            "블로그ID": ch["blog_id"],
            "예약날짜": pub.get("date", ""),
            "예약시간": pub.get("time", ""),
            "카테고리": pub.get("category", ""),
            "제목": r["title"],
            "공개범위": pub.get("visibility", "closed"),
            "이미지": img["count"],
            "본문지문": r["hash"],
            "체크리스트": c.rel(r["dir"] / "upload_checklist.md"),
        })

    # ── 걸린 글 알리기 ────────────────────────────────────
    if blocked:
        c.say()
        for pid, issues in blocked:
            c.error(f"{pid} — 준비하지 않았습니다.")
            for i in issues:
                c.say(f"      ✗ {i}")
        c.say()
        c.say("      고친 뒤 다시 실행해 주세요.")
        c.say("      정말 그대로 진행하려면 --ignore-conflicts 를 붙이세요.")

    if waiting:
        c.say()
        for pid, why in waiting:
            c.info(f"{pid} — 아직 차례가 아닙니다 ({why})")

    if not ready:
        c.say()
        c.warn("준비된 글이 없습니다.")
        c.say("      승인하려면:  python scripts/approve.py")
        return

    ready.sort(key=lambda r: (r["예약날짜"], r["예약시간"]))
    for i, row in enumerate(ready, 1):
        row["순서"] = i

    csv_path = wdir / "발행순서.csv"
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(ready[0].keys()))
        w.writeheader()
        w.writerows(ready)

    write_guide(wdir, ready)

    c.say()
    c.ok(f"{len(ready)}편의 업로드 패키지를 만들었습니다.")
    c.ok(f"안내: {c.rel(wdir / '발행안내.md')}")
    c.say()
    c.say("  ⚠ post.html 은 눈으로 확인하는 용도입니다. 붙여넣지 마세요.")
    c.say("     실제 업로드는 각 글의 publish/upload_checklist.md 를 따라 주세요.")
    c.get_logger().info(f"발행 준비 {wdir.name}: {len(ready)}편")


def write_guide(wdir: Path, ready: list[dict]) -> None:
    lines = [
        f"# {wdir.name} 발행 안내",
        "",
        f"승인된 글 **{len(ready)}편**의 업로드 자료가 준비됐습니다.",
        "",
        "> ## ⚠ 처음이라면 꼭 읽어 주세요",
        ">",
        "> **1. HTML을 붙여넣지 마세요.**",
        "> 네이버 스마트에디터 ONE 은 HTML 글쓰기를 지원하지 않습니다.",
        "> `post.html` 은 눈으로 확인하는 용도입니다.",
        "> 실제 업로드는 각 글의 `publish/` 폴더 자료를 씁니다.",
        ">",
        "> **2. 이미지는 포토 업로더로 올리세요.**",
        "> 복사·붙여넣기로 넣은 이미지는 원본이 옮겨지거나 지워지면",
        "> 글에서 사라질 수 있습니다. 편집기의 사진 단추로 파일을 직접 올려 주세요.",
        ">",
        "> **3. 처음에는 1편만, 비공개로.**",
        "> 서식이 제대로 들어가는지 확인한 뒤 나머지를 진행하세요.",
        "> 네이버는 광고성 대량 발행을 막으려고 글쓰기 API를 종료한 적이 있습니다.",
        "",
        "## 등록 순서",
        "",
        "| 순서 | 예약 일시 | 채널 | 제목 | 이미지 | 할 일 |",
        "|---|---|---|---|---|---|",
    ]
    base = Path(c.rel(wdir))
    for r in ready:
        rel_check = Path(r["체크리스트"]).relative_to(base)
        lines.append(
            f"| {r['순서']} | {r['예약날짜']} {r['예약시간']} | {r['채널']} "
            f"| {r['제목']} | {r['이미지']}장 | [체크리스트]({rel_check}) |"
        )
    lines += [
        "",
        "## 각 글마다 이렇게 합니다",
        "",
        "1. 위 표의 **체크리스트**를 엽니다.",
        "2. 0단계에서 **블로그 ID 7가지 확인**을 반드시 눈으로 대조합니다.",
        "3. 순서대로 제목 → 본문 → 이미지 → 태그를 넣습니다.",
        "4. **비공개로 먼저 저장**하고 화면을 확인합니다.",
        "5. 확인이 끝나면 예약을 겁니다.",
        "6. 예약 목록에서 제목과 시각을 다시 확인합니다.",
        "",
        "## 진행 상황 기록하기",
        "",
        "단계를 마칠 때마다 기록해 두면 어디까지 했는지 잊지 않습니다.",
        "",
        "```",
        "python scripts/publish_status.py --set draft_saved            --post <ID>",
        "python scripts/publish_status.py --set reservation_requested  --post <ID>",
        "python scripts/publish_status.py --set reservation_verified   --post <ID>",
        "python scripts/publish_status.py --set post_publish_verified  --post <ID> --url <주소>",
        "```",
        "",
        "전체 상태 보기:",
        "",
        "```",
        "python scripts/publish_status.py",
        "```",
        "",
    ]
    c.write_text(wdir / "발행안내.md", "\n".join(lines))


if __name__ == "__main__":
    main()
