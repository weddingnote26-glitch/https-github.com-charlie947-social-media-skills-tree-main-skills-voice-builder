# -*- coding: utf-8 -*-
"""
네이버 업로드 패키지 만들기

  스마트에디터 ONE 은 HTML 글쓰기를 지원하지 않습니다.
  HTML을 통째로 붙여넣는 방식은 서식이 깨질 수 있어 쓰지 않습니다.
  대신 편집기에 그대로 옮길 수 있는 자료를 만들어 둡니다.

만들어지는 것 (글마다 publish/ 폴더)
  title.txt              제목 (순수 텍스트)
  body.txt               본문 (숨은 태그 없는 순수 텍스트)
  blocks.yaml            문단·소제목·이미지·목록의 입력 순서
  images/                포토 업로더로 올릴 이미지 (01_, 02_ … 순서대로)
  image_order.csv        이미지 파일과 들어갈 자리
  publish_settings.yaml  채널·카테고리·공개설정·예약일시·태그
  upload_checklist.md    사람이 따라가는 체크리스트
  result.json            입력·예약·발행·검증 결과 기록

실행:  python scripts/build_package.py [--week 2026-W36] [--post <게시물ID>]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts import blocks as B            # noqa: E402
from scripts import imagecheck             # noqa: E402
from scripts.postfile import PostFile      # noqa: E402


def content_hash(title: str, body: str) -> str:
    """중복 발행을 막기 위한 본문 지문. 공백 차이는 무시합니다."""
    norm = "".join((title + body).split())
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]


def build(pdir: Path, settings: dict) -> dict:
    post = PostFile.load(pdir / "post.md")
    meta = c.read_yaml(pdir / "metadata.yaml", default={}) or {}
    ch = c.get_channel(pdir.parent.name)
    pub = meta.get("publish") or {}

    out = pdir / "publish"
    img_out = out / "images"
    c.ensure_dir(img_out)

    blks = B.parse(post.body)
    refs = post.image_refs()
    declared = post.get("images") or []

    # ── 이미지 검사 ────────────────────────────────────────
    img_report = imagecheck.check(declared, refs, pdir / "images")

    # ── 제목 ──────────────────────────────────────────────
    title = str(post.get("title") or "").strip()
    c.write_text(out / "title.txt", title + "\n")

    # ── 본문 (순수 텍스트) ─────────────────────────────────
    body_txt = B.to_plain_text(blks)
    c.write_text(out / "body.txt", body_txt)

    # ── 블록 명세 ─────────────────────────────────────────
    # 이미지 블록의 파일명은 publish/images/ 안의 순서 붙은 이름으로 바꿉니다.
    rename: dict[str, str] = {}
    for i, name in enumerate(refs, 1):
        rename[name] = f"{i:02d}_{name}"

    spec_blocks = []
    for b in blks:
        nb = dict(b)
        if nb["type"] == "image":
            nb["file"] = f"images/{rename.get(nb['file'], nb['file'])}"
            nb["source_file"] = b["file"]
        spec_blocks.append(nb)

    c.write_yaml(out / "blocks.yaml", {
        "post_id": meta.get("post_id"),
        "channel": ch["key"],
        "blog_id": ch["blog_id"],
        "note": ("네이버 편집기에서 이 순서대로 넣으세요. "
                 "HTML을 붙여넣지 마세요."),
        "block_count": len(spec_blocks),
        "summary": B.summary(blks),
        "blocks": spec_blocks,
    })

    # ── 이미지 복사 (순서 번호를 붙여서) ───────────────────
    for name, newname in rename.items():
        src = pdir / "images" / name
        if src.exists():
            shutil.copy2(src, img_out / newname)

    # ── 이미지 순서표 ─────────────────────────────────────
    rows = []
    block_pos = {b["file"]: i for i, b in enumerate(blks, 1) if b["type"] == "image"}
    for f in img_report["files"]:
        orig = f["file"]
        rows.append({
            "순서": f["no"],
            "파일명": rename.get(orig, orig),
            "원본파일명": orig,
            "블록번호": block_pos.get(orig, ""),
            "들어갈자리": f.get("position", ""),
            "대체텍스트": f.get("alt") or "",
            "용량": f.get("size_text", ""),
            "대표이미지": "예" if f["no"] == 1 else "",
        })
    if rows:
        with open(out / "image_order.csv", "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    # ── 발행 설정 ─────────────────────────────────────────
    chash = content_hash(title, post.body)
    c.write_yaml(out / "publish_settings.yaml", {
        "post_id": meta.get("post_id"),
        "content_hash": chash,
        "channel": {
            "key": ch["key"],
            "name": ch["name"],
            "blog_id": ch["blog_id"],
            "url": ch["url"],
            "confirm_phrase": ch["confirm_phrase"],
        },
        "title": title,
        "category": pub.get("category"),
        "schedule": {
            "date": pub.get("date"),
            "time": pub.get("time"),
            "weekday": post.get("weekday"),
            "timezone": "Asia/Seoul",
        },
        "visibility": pub.get("visibility", "closed"),
        "allow_comment": True,
        "allow_search": True,
        "tags": post.hashtags(),
        "images": {
            "count": img_report["count"],
            "total_mb": img_report["total_mb"],
            "upload_method": "네이버 포토 업로더로 파일 직접 등록 (복사·붙여넣기 금지)",
        },
        "naver_log_no": None,
        "post_url": None,
    })

    # ── 결과 기록 파일 ────────────────────────────────────
    result_path = out / "result.json"
    if not result_path.exists():
        c.write_json(result_path, {
            "post_id": meta.get("post_id"),
            "content_hash": chash,
            "steps": {
                "editor_filled": None,
                "draft_saved": None,
                "reservation_requested": None,
                "reservation_verified": None,
                "published": None,
                "post_publish_verified": None,
            },
            "naver_log_no": None,
            "post_url": None,
            "failures": [],
            "checkpoints": [],
        })

    # ── 사람이 따라가는 체크리스트 ─────────────────────────
    write_checklist(out, post, meta, ch, blks, img_report, chash)

    # ── metadata 갱신 ─────────────────────────────────────
    meta["content_hash"] = chash
    meta.setdefault("package", {}).update({
        "built_at": c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST"),
        "path": c.rel(out),
        "blocks": len(blks),
        "images": img_report["count"],
    })
    c.write_yaml(pdir / "metadata.yaml", meta)

    return {"dir": out, "blocks": len(blks), "images": img_report,
            "hash": chash, "title": title}


def write_checklist(out: Path, post: PostFile, meta: dict, ch: dict,
                    blks: list, img: dict, chash: str) -> None:
    pub = meta.get("publish") or {}
    heads = [b for b in blks if b["type"] == "heading"]
    lines = [
        f"# 업로드 체크리스트 — {meta.get('post_id')}",
        "",
        "> 네이버 스마트에디터 ONE 은 HTML 글쓰기를 지원하지 않습니다.",
        "> **`post.html` 을 붙여넣지 마세요.** 그 파일은 눈으로 확인하는 용도입니다.",
        "> 아래 순서대로 `body.txt` 와 `blocks.yaml` 을 보고 넣어 주세요.",
        "",
        "---",
        "",
        "## 0단계 — 시작 전 확인 (가장 중요)",
        "",
        "네이버 화면을 보면서 아래 **일곱 가지**를 하나씩 눈으로 대조하세요.",
        "하나라도 다르면 **멈추고** 원인을 확인하세요.",
        "",
        "| # | 확인할 것 | 맞아야 하는 값 | 확인 |",
        "|---|---|---|---|",
        f"| 1 | 로그인한 네이버 계정 | (이 블로그를 쓰는 계정) | ☐ |",
        f"| 2 | **블로그 ID** | **`{ch['blog_id']}`** | ☐ |",
        f"| 3 | 블로그 이름 | {ch['name']} | ☐ |",
        f"| 4 | 원고의 채널 | {ch['confirm_phrase']} | ☐ |",
        f"| 5 | 카테고리 | {pub.get('category','')} | ☐ |",
        f"| 6 | 제목 | {post.get('title')} | ☐ |",
        f"| 7 | 예약 일시 | {pub.get('date')} ({post.get('weekday')}) {pub.get('time')} | ☐ |",
        "",
        f"> 두 블로그를 헷갈리면 되돌리기 어렵습니다.",
        f"> 이 글은 **{ch['name']}** ( `{ch['blog_id']}` ) 에 올라가는 글입니다.",
        "",
        "## 1단계 — 글쓰기 화면 열기",
        "",
        f"1. `{ch['url']}` 로 들어갑니다.",
        "2. 글쓰기를 누릅니다.",
        "3. 위 0단계의 블로그 ID를 주소창에서 한 번 더 확인합니다.",
        "",
        "## 2단계 — 제목 넣기",
        "",
        "`title.txt` 의 내용을 그대로 복사해서 제목 칸에 붙여넣습니다.",
        "",
        "```",
        f"{post.get('title')}",
        "```",
        "",
        "## 3단계 — 본문 넣기",
        "",
        "`body.txt` 를 열어 전체 복사한 뒤 본문에 붙여넣습니다.",
        "그다음 `blocks.yaml` 을 보면서 아래를 편집기 도구로 지정합니다.",
        "",
        f"- **소제목 {len(heads)}개** — 아래 줄을 소제목(제목2) 서식으로 바꿉니다.",
    ]
    for h in heads:
        lines.append(f"  - {h['text']}")
    lines += [
        "",
        f"- **▶ 이미지 넣기** 로 표시된 {img['count']}줄 — 그 자리에 이미지를 넣고 그 줄은 지웁니다.",
        "",
        "## 4단계 — 이미지 올리기",
        "",
        "> ⚠ 이미지를 **복사·붙여넣기로 넣지 마세요.**",
        "> 원본 파일이 옮겨지거나 지워지면 글에서 이미지가 사라질 수 있습니다.",
        "> 반드시 편집기의 **사진(포토 업로더)** 단추로 파일을 직접 올려 주세요.",
        "",
        "`images/` 폴더의 파일을 번호 순서대로 올립니다.",
        "",
        "| 순서 | 파일 | 들어갈 자리 | 대체 텍스트 |",
        "|---|---|---|---|",
    ]
    for f in img["files"]:
        lines.append(f"| {f['no']} | `{f['no']:02d}_{f['file']}` "
                     f"| {f.get('position','')} | {f.get('alt','')} |")
    lines += [
        "",
        f"올린 뒤 확인: 이미지가 **{img['count']}장** 모두 보이는지, 순서가 맞는지,",
        "섬네일(작은 미리보기)이 만들어졌는지.",
        "",
        "## 5단계 — 태그와 설정",
        "",
        "**태그** (아래를 그대로 넣습니다)",
        "",
        "```",
        " ".join("#" + t for t in post.hashtags()),
        "```",
        "",
        f"- 카테고리: **{pub.get('category','')}**",
        f"- 공개 설정: **{pub.get('visibility','closed')}**",
        "",
        "## 6단계 — 비공개로 먼저 저장",
        "",
        "예약을 걸기 **전에** 비공개로 한 번 저장하고 화면을 확인하세요.",
        "",
        "- [ ] 제목이 한 번만 들어갔는가",
        "- [ ] 본문 첫 문장과 마지막 문장이 있는가",
        "- [ ] 소제목이 모두 들어갔는가",
        "- [ ] 이미지 개수와 순서가 맞는가",
        "- [ ] 투자 유의 문구가 있는가",
        "- [ ] 태그가 맞는가",
        "- [ ] 모바일 화면에서 줄바꿈이 이상하지 않은가",
        "",
        "확인이 끝나면 기록을 남깁니다.",
        "",
        "```",
        f"python scripts/publish_status.py --set draft_saved --post {meta.get('post_id')}",
        "```",
        "",
        "## 7단계 — 예약 걸기",
        "",
        f"발행 → 예약 → **{pub.get('date')} {pub.get('time')}** 을 넣고 저장합니다.",
        "",
        "```",
        f"python scripts/publish_status.py --set reservation_requested --post {meta.get('post_id')}",
        "```",
        "",
        "## 8단계 — 예약 목록에서 다시 확인",
        "",
        "글쓰기 화면 위쪽의 **예약 건수**를 눌러 목록을 엽니다.",
        "",
        "- [ ] 이 글이 목록에 있는가",
        "- [ ] 제목이 맞는가",
        f"- [ ] 예약 시각이 **{pub.get('date')} {pub.get('time')}** 인가",
        f"- [ ] 채널이 **{ch['name']}** 인가",
        f"- [ ] 카테고리가 **{pub.get('category','')}** 인가",
        "",
        "```",
        f"python scripts/publish_status.py --set reservation_verified --post {meta.get('post_id')}",
        "```",
        "",
        "## 9단계 — 발행일에 실제로 올라갔는지",
        "",
        "예약 시각이 지난 뒤 글 주소를 열어 확인합니다.",
        "",
        "- [ ] 글이 열리는가",
        "- [ ] 전체 공개인가",
        "- [ ] 이미지가 모두 보이는가",
        "- [ ] 대표 이미지가 나오는가",
        "- [ ] 태그가 보이는가",
        "- [ ] 검색 허용이 켜져 있는가",
        "",
        "```",
        f"python scripts/publish_status.py --set post_publish_verified "
        f"--post {meta.get('post_id')} --url <글주소>",
        "```",
        "",
        "> 검색 결과에 바로 안 나와도 실패가 아닙니다.",
        "> 네이버는 등록 후 검색 반영까지 시간이 걸릴 수 있다고 안내합니다.",
        "> **게시 성공**과 **검색 노출**은 다른 일입니다.",
        "",
        "---",
        "",
        f"본문 지문(중복 확인용): `{chash}`",
        "",
    ]
    c.write_text(out / "upload_checklist.md", "\n".join(lines))


def main() -> None:
    ap = argparse.ArgumentParser(description="네이버 업로드 패키지를 만듭니다.")
    ap.add_argument("--week")
    ap.add_argument("--post")
    args = ap.parse_args()

    try:
        settings = c.load_settings()
    except c.ConfigError as e:
        c.error(str(e)); raise SystemExit(1)

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)
    c.header(f"{wdir.name} 업로드 패키지 만들기")

    made = 0
    for meta_path in sorted(wdir.rglob("metadata.yaml")):
        pdir = meta_path.parent
        meta = c.read_yaml(meta_path, default={}) or {}
        if args.post and meta.get("post_id") != args.post:
            continue
        if not (pdir / "post.md").exists():
            continue
        if not c.can_touch_naver(meta.get("status", "draft")):
            c.info(f"{meta.get('post_id')} — 승인 전이라 건너뜁니다 "
                   f"({c.STATUS_KO.get(meta.get('status'), '?')})")
            continue

        r = build(pdir, settings)
        made += 1
        c.ok(f"{meta.get('post_id')} — 블록 {r['blocks']}개 · "
             f"이미지 {r['images']['count']}장({r['images']['total_text']}) · "
             f"{c.rel(r['dir'])}")
        for e in r["images"]["errors"]:
            c.warn(f"    이미지: {e}")
        for w in r["images"]["warnings"]:
            c.say(f"      △ {w}")

    c.say()
    if made:
        c.ok(f"{made}편의 업로드 패키지를 만들었습니다.")
        c.say()
        c.say("  각 글 폴더의 publish/upload_checklist.md 를 보고 진행하세요.")
        c.say("  ⚠ post.html 은 눈으로 확인하는 용도입니다. 붙여넣지 마세요.")
    else:
        c.warn("승인된 글이 없습니다.  python scripts/approve.py")


if __name__ == "__main__":
    main()
