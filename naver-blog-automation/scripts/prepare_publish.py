# -*- coding: utf-8 -*-
"""
네이버 예약 발행 준비 — 승인된 글을 '바로 올릴 수 있는 묶음'으로 만듭니다.

  네이버에는 글을 자동으로 올려주는 공식 기능이 없습니다.
  (블로그 글쓰기 API는 2020년 5월에 종료되었습니다)
  그래서 이 단계는 '사람이 붙여넣기 쉽게 준비해 주는 것' 까지 합니다.

만드는 것
  · 주차 폴더에  발행안내.md      — 순서대로 무엇을 할지
  · 주차 폴더에  발행순서.csv     — 엑셀로 보는 일정표
  · 글마다      발행카드.md      — 채널·카테고리·예약일시 최종 확인표
  · 글마다      post.html        — 붙여넣기용 (없으면 새로 만듭니다)

실행:  python scripts/prepare_publish.py [--week 2026-W36]
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts.postfile import PostFile      # noqa: E402
from scripts.render_html import render     # noqa: E402


def make_card(pdir: Path, post: PostFile, meta: dict, ch: dict) -> Path:
    pub = meta.get("publish") or {}
    tags = post.hashtags()
    lines = [
        f"# 발행 카드 — {meta.get('post_id')}",
        "",
        "> 네이버 글쓰기 화면에 옮기기 **직전에** 이 표를 한 번 대조해 주세요.",
        "> 특히 **블로그 ID**가 맞는지 꼭 확인하세요. 두 채널이 뒤바뀌면 되돌리기 어렵습니다.",
        "",
        "## 어디에 올리나요",
        "",
        "| 항목 | 값 |",
        "|---|---|",
        f"| **채널** | **{ch['name']}** |",
        f"| **블로그 주소** | {ch['url']} |",
        f"| **블로그 ID** | `{ch['blog_id']}` |",
        f"| 확인 문구 | {ch['confirm_phrase']} |",
        f"| 카테고리 | {pub.get('category', '')} |",
        "",
        "## 언제 올라가나요",
        "",
        "| 항목 | 값 |",
        "|---|---|",
        f"| **예약 날짜** | **{pub.get('date')} ({post.get('weekday')})** |",
        f"| **예약 시간** | **{pub.get('time')}** (한국시간) |",
        f"| 공개 범위 | {pub.get('visibility', 'closed')} |",
        "",
        "## 무엇을 올리나요",
        "",
        f"**제목**",
        "```",
        f"{post.get('title')}",
        "```",
        "",
        f"**해시태그** ({len(tags)}개)",
        "```",
        " ".join("#" + t for t in tags),
        "```",
        "",
        "**이미지** — 아래 파일을 본문의 표시된 자리에 올려 주세요.",
        "",
    ]
    imgs = post.get("images") or []
    if imgs:
        lines += ["| 파일 | 위치 | 대체 텍스트 |", "|---|---|---|"]
        for im in imgs:
            if isinstance(im, dict):
                lines.append(
                    f"| `{im.get('file','')}` | {im.get('position','')} "
                    f"| {im.get('alt','')} |"
                )
    else:
        lines.append("(이미지 없음)")

    lines += [
        "",
        "## 올리는 순서",
        "",
        "1. 네이버에 로그인하고 **위에 적힌 블로그**로 들어갑니다.",
        "2. 글쓰기를 누릅니다.",
        f"3. `{c.rel(pdir / 'post.html')}` 파일을 브라우저로 열고 "
        f"전체 선택(Ctrl+A) → 복사(Ctrl+C) 합니다.",
        "4. 네이버 글쓰기 화면에 붙여넣기(Ctrl+V) 합니다.",
        "5. 제목을 위 제목으로 바꿉니다.",
        "6. 📷 표시가 있는 자리에 이미지를 올립니다.",
        "7. 우측 상단 **발행** → **예약** 을 고르고 위 날짜·시간을 넣습니다.",
        f"8. 카테고리를 `{pub.get('category','')}` 로 고릅니다.",
        "9. 해시태그를 붙여넣습니다.",
        "10. 예약을 저장합니다.",
        "",
        "## 올린 뒤에",
        "",
        "```",
        f"python scripts/publish_status.py --mark-published {meta.get('post_id')} --url <글주소>",
        "```",
        "",
        "---",
        "",
        "### 참고 자료",
        "",
        f"- 원고: `{c.rel(pdir / 'post.md')}`",
        f"- 출처: `{c.rel(pdir / 'sources.md')}`",
        f"- 검수 결과: `{c.rel(pdir / 'checklist.md')}`",
        "",
    ]
    return c.write_text(pdir / "발행카드.md", "\n".join(lines))


def main() -> None:
    ap = argparse.ArgumentParser(description="네이버 예약 발행용 자료를 준비합니다.")
    ap.add_argument("--week")
    args = ap.parse_args()

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)
    c.header(f"{wdir.name} 예약 발행 준비")

    approved, blocked, seen_ids = [], [], {}

    for meta_path in sorted(wdir.rglob("metadata.yaml")):
        pdir = meta_path.parent
        meta = c.read_yaml(meta_path, default={}) or {}
        pid = meta.get("post_id", pdir.name)
        status = meta.get("status", "draft")
        ch_key = pdir.parent.name

        # 중복 발행 방지 — 같은 ID가 두 번 나오면 멈춥니다.
        if pid in seen_ids:
            c.error(f"게시물 ID가 중복됩니다: {pid}\n"
                    f"      {c.rel(seen_ids[pid])} 와 {c.rel(pdir)}")
            raise SystemExit(1)
        seen_ids[pid] = pdir

        if status not in ("approved", "scheduled", "published"):
            blocked.append((pid, status))
            continue
        if not (pdir / "post.md").exists():
            blocked.append((pid, "원고 없음"))
            continue

        post = PostFile.load(pdir / "post.md")
        ch = c.get_channel(ch_key)

        # 마지막 채널 확인
        if str(post.get("blog_id")) != ch["blog_id"]:
            c.error(f"{pid} — 블로그 ID가 설정과 다릅니다. 준비하지 않았습니다.")
            blocked.append((pid, "블로그 ID 불일치"))
            continue

        render(pdir)
        make_card(pdir, post, meta, ch)
        approved.append({
            "순서": 0,
            "게시물ID": pid,
            "채널": ch["name"],
            "블로그ID": ch["blog_id"],
            "예약날짜": (meta.get("publish") or {}).get("date", ""),
            "예약시간": (meta.get("publish") or {}).get("time", ""),
            "카테고리": (meta.get("publish") or {}).get("category", ""),
            "제목": meta.get("title", ""),
            "공개범위": (meta.get("publish") or {}).get("visibility", "closed"),
            "발행카드": c.rel(pdir / "발행카드.md"),
        })
        c.ok(f"{pid} — 준비 완료")

    if blocked:
        c.say()
        for pid, why in blocked:
            c.warn(f"{pid} — 아직 준비할 수 없습니다 "
                   f"({c.STATUS_KO.get(why, why)})")

    if not approved:
        c.say()
        c.warn("승인된 글이 없습니다.")
        c.say("      승인하려면:  python scripts/approve.py")
        return

    approved.sort(key=lambda r: (r["예약날짜"], r["예약시간"]))
    for i, row in enumerate(approved, 1):
        row["순서"] = i

    csv_path = wdir / "발행순서.csv"
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(approved[0].keys()))
        w.writeheader()
        w.writerows(approved)

    guide = [
        f"# {wdir.name} 발행 안내",
        "",
        f"승인된 글 **{len(approved)}편**을 네이버에 예약 등록할 준비가 끝났습니다.",
        "",
        "> ⚠ **처음이라면 꼭 읽어 주세요**",
        ">",
        "> 네이버는 글쓰기 API를 2020년 5월에 종료했습니다.",
        "> 자동으로 대량 등록하는 방식은 계정에 불이익이 갈 수 있습니다.",
        "> **처음에는 1편만, 비공개로** 올려서 서식이 잘 들어가는지 확인한 뒤",
        "> 나머지를 진행하시길 권합니다.",
        "",
        "## 등록 순서",
        "",
        "| 순서 | 예약 일시 | 채널 | 제목 | 발행 카드 |",
        "|---|---|---|---|---|",
    ]
    for r in approved:
        guide.append(
            f"| {r['순서']} | {r['예약날짜']} {r['예약시간']} | {r['채널']} "
            f"| {r['제목']} | [열기]({Path(r['발행카드']).relative_to(c.rel(wdir))}) |"
        )
    guide += [
        "",
        "## 한 편씩 이렇게 합니다",
        "",
        "1. 위 표에서 **발행 카드**를 엽니다.",
        "2. 카드에 적힌 **블로그 ID**가 맞는지 확인합니다.",
        "3. 카드의 순서대로 네이버에 붙여넣고 예약을 겁니다.",
        "4. 다 올린 뒤 아래 명령으로 기록을 남깁니다.",
        "",
        "```",
        "python scripts/publish_status.py --mark-published <게시물ID> --url <글주소>",
        "```",
        "",
        "## 전체 상태 보기",
        "",
        "```",
        "python scripts/publish_status.py",
        "```",
        "",
    ]
    guide_path = c.write_text(wdir / "발행안내.md", "\n".join(guide))

    c.say()
    c.ok(f"{len(approved)}편의 발행 자료를 준비했습니다.")
    c.ok(f"안내: {c.rel(guide_path)}")
    c.ok(f"일정표: {c.rel(csv_path)}")
    c.say()
    c.say("  ⚠ 처음에는 1편만 비공개로 시험해 보세요.")
    c.get_logger().info(f"발행 준비 {wdir.name}: {len(approved)}편")


if __name__ == "__main__":
    main()
