# -*- coding: utf-8 -*-
"""
원고를 네이버 붙여넣기용 HTML로 바꿉니다.

  · 네이버 스마트에디터는 바깥 CSS 파일을 읽지 못합니다.
    그래서 모든 서식을 각 태그 안에 직접 적어 넣습니다.
  · 이미지는 자동으로 올라가지 않습니다.
    자리 표시만 넣어 두고 사람이 직접 올립니다.

실행:  python scripts/render_html.py [--week 2026-W36] [--post <게시물ID>]
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts.postfile import PostFile      # noqa: E402

# 채널별 읽기 편한 글자 크기 — 50~70대 독자는 더 크게
FONT = {"coin": ("17px", "1.85"), "stock": ("19px", "2.0")}


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def inline(text: str) -> str:
    """굵게·기울임·인라인코드를 HTML로."""
    text = esc(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", text)
    text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
    return text


def render_body(body: str, ch_key: str, colors: dict) -> str:
    primary = colors.get("primary_color", "#2B6CB0")
    accent = colors.get("accent_color", "#F6AD55")
    out: list[str] = []
    buf: list[str] = []
    in_list = False

    def flush_para():
        nonlocal buf
        if buf:
            out.append(
                f'  <p style="margin:0 0 1.1em;">{inline(" ".join(buf))}</p>'
            )
            buf = []

    def close_list():
        nonlocal in_list
        if in_list:
            out.append("  </ul>")
            in_list = False

    for raw in body.splitlines():
        line = raw.rstrip()

        if not line.strip():
            flush_para(); close_list()
            continue

        # 이미지 자리
        m = re.fullmatch(r"\[이미지:\s*([^\]]+?)\s*\]", line.strip())
        if m:
            flush_para(); close_list()
            out.append(
                f'  <p style="margin:1.6em 0;padding:26px;text-align:center;'
                f'background:#F7FAFC;border:2px dashed {accent};border-radius:8px;'
                f'color:#555;font-size:.92em;">'
                f'📷 여기에 <b>{esc(m.group(1))}</b> 이미지를 올려 주세요'
                f'</p>'
            )
            continue

        # 구분선
        if re.fullmatch(r"-{3,}", line.strip()):
            flush_para(); close_list()
            out.append(f'  <hr style="border:0;border-top:1px solid #E2E8F0;'
                       f'margin:2em 0;">')
            continue

        # 소제목
        m = re.match(r"^(#{2,3})\s+(.*)$", line)
        if m:
            flush_para(); close_list()
            size = "1.25em" if len(m.group(1)) == 2 else "1.1em"
            out.append(
                f'  <h3 style="font-size:{size};font-weight:700;color:{primary};'
                f'margin:2em 0 .7em;padding-left:12px;'
                f'border-left:5px solid {accent};">{inline(m.group(2))}</h3>'
            )
            continue

        # 목록
        m = re.match(r"^[-*•]\s+(.*)$", line)
        if m:
            flush_para()
            if not in_list:
                out.append('  <ul style="margin:0 0 1.2em;padding-left:1.3em;">')
                in_list = True
            out.append(f'    <li style="margin-bottom:.55em;">{inline(m.group(1))}</li>')
            continue

        # 해시태그 줄
        if re.match(r"^\s*#[^\s#]", line):
            flush_para(); close_list()
            tags = " ".join(f'<span style="color:{primary};">{esc(t)}</span>'
                            for t in line.split())
            out.append(f'  <p style="margin:2em 0 0;font-size:.92em;">{tags}</p>')
            continue

        close_list()
        buf.append(line.strip())

    flush_para(); close_list()
    return "\n".join(out)


def render(pdir: Path) -> Path | None:
    post_path = pdir / "post.md"
    if not post_path.exists():
        return None

    post = PostFile.load(post_path)
    ch_key = pdir.parent.name
    ch = c.get_channel(ch_key)
    design = ch.get("design", {})
    font_size, line_height = FONT.get(ch_key, ("17px", "1.85"))

    try:
        d = dt.date.fromisoformat(str(post.get("publish_date")))
        weekday = c.weekday_ko(d)
    except (ValueError, TypeError):
        weekday = str(post.get("weekday", ""))

    tpl = c.read_text(c.TEMPLATE_DIR / "post_template.html")
    body_html = render_body(post.body, ch_key, design)

    out = tpl
    for k, v in {
        "title": esc(str(post.get("title", ""))),
        "channel_name": esc(ch["name"]),
        "publish_date": str(post.get("publish_date", "")),
        "weekday_ko": weekday,
        "primary_color": design.get("primary_color", "#2B6CB0"),
        "font_size": font_size,
        "line_height": line_height,
        "body": body_html,
    }.items():
        out = out.replace("{{" + k + "}}", v)

    return c.write_text(pdir / "post.html", out)


def main() -> None:
    ap = argparse.ArgumentParser(description="원고를 붙여넣기용 HTML로 바꿉니다.")
    ap.add_argument("--week")
    ap.add_argument("--post")
    args = ap.parse_args()

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)
    c.header(f"{wdir.name} HTML 변환")

    n = 0
    for pm in sorted(wdir.rglob("post.md")):
        if args.post:
            meta = c.read_yaml(pm.parent / "metadata.yaml", default={}) or {}
            if meta.get("post_id") != args.post:
                continue
        p = render(pm.parent)
        if p:
            c.ok(c.rel(p))
            n += 1
    c.say()
    c.ok(f"{n}편을 HTML로 바꿨습니다.")


if __name__ == "__main__":
    main()
