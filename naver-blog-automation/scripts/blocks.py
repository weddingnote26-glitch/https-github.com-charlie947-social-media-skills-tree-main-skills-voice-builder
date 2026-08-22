# -*- coding: utf-8 -*-
"""
원고를 네이버 편집기 구성요소 단위로 쪼갭니다.

왜 이렇게 하나요
  네이버 스마트에디터 ONE 은 HTML 글쓰기를 지원하지 않습니다.
  HTML을 통째로 붙여넣으면 서식이 깨지거나 숨은 태그가 섞일 수 있습니다.
  그래서 원고를 '문단 / 소제목 / 이미지 / 목록 / 구분선' 단위로 나눠 두고,
  편집기에서 그 순서대로 넣도록 안내합니다.

블록 종류
  paragraph  일반 문단
  heading    소제목 (level 2 또는 3)
  image      이미지 자리 (파일명 + 캡션)
  list       목록 (bullet 또는 number)
  divider    구분선
  quote      인용
  hashtags   해시태그 줄
"""
from __future__ import annotations

import re
from typing import Any

IMG_RE = re.compile(r"^\[이미지:\s*([^\]|]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]$")
HEAD_RE = re.compile(r"^(#{2,3})\s+(.*)$")
BULLET_RE = re.compile(r"^\s*[-*•]\s+(.*)$")
NUMBER_RE = re.compile(r"^\s*(\d+)[.)]\s+(.*)$")
QUOTE_RE = re.compile(r"^\s*>\s?(.*)$")
DIVIDER_RE = re.compile(r"^\s*-{3,}\s*$")
HASHTAG_RE = re.compile(r"^\s*#[^\s#]")

# 편집기에 넣을 때는 마크다운 기호를 쓰지 않습니다. 순수 텍스트로 바꿉니다.
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
ITALIC_RE = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
CODE_RE = re.compile(r"`(.+?)`")


def plain(text: str) -> str:
    """마크다운 기호를 걷어내고 순수 텍스트만 남깁니다."""
    text = BOLD_RE.sub(r"\1", text)
    text = ITALIC_RE.sub(r"\1", text)
    text = CODE_RE.sub(r"\1", text)
    return text.strip()


def emphasis_spans(text: str) -> list[str]:
    """굵게 처리할 부분을 따로 뽑아 둡니다. 편집기에서 직접 지정하도록."""
    return [m.group(1).strip() for m in BOLD_RE.finditer(text)]


def parse(body: str) -> list[dict[str, Any]]:
    """원고 본문을 블록 목록으로 바꿉니다."""
    blocks: list[dict[str, Any]] = []
    lines = body.splitlines()
    i = 0
    para_buf: list[str] = []
    img_no = 0

    def flush_para() -> None:
        nonlocal para_buf
        if not para_buf:
            return
        raw = " ".join(para_buf).strip()
        if raw:
            block: dict[str, Any] = {
                "type": "paragraph",
                "text": plain(raw),
                "align": "left",
            }
            em = emphasis_spans(raw)
            if em:
                block["emphasis"] = em
            blocks.append(block)
        para_buf = []

    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()

        if not stripped:
            flush_para()
            i += 1
            continue

        # 이미지 —  [이미지:파일명]  또는  [이미지:파일명 | 캡션]
        m = IMG_RE.match(stripped)
        if m:
            flush_para()
            img_no += 1
            blocks.append({
                "type": "image",
                "index": img_no,
                "file": m.group(1).strip(),
                "caption": (m.group(2) or "").strip() or None,
            })
            i += 1
            continue

        # 구분선
        if DIVIDER_RE.match(stripped):
            flush_para()
            blocks.append({"type": "divider"})
            i += 1
            continue

        # 소제목
        m = HEAD_RE.match(stripped)
        if m:
            flush_para()
            blocks.append({
                "type": "heading",
                "level": len(m.group(1)),
                "text": plain(m.group(2)),
            })
            i += 1
            continue

        # 해시태그 줄
        if HASHTAG_RE.match(stripped):
            flush_para()
            tags = [w.lstrip("#") for w in stripped.split() if w.startswith("#")]
            blocks.append({"type": "hashtags", "tags": tags})
            i += 1
            continue

        # 인용
        m = QUOTE_RE.match(stripped)
        if m:
            flush_para()
            buf = [plain(m.group(1))]
            i += 1
            while i < len(lines) and QUOTE_RE.match(lines[i].strip()):
                buf.append(plain(QUOTE_RE.match(lines[i].strip()).group(1)))
                i += 1
            blocks.append({"type": "quote", "text": " ".join(x for x in buf if x)})
            continue

        # 목록 (글머리표 / 번호)
        if BULLET_RE.match(stripped) or NUMBER_RE.match(stripped):
            flush_para()
            style = "bullet" if BULLET_RE.match(stripped) else "number"
            items: list[dict[str, Any]] = []
            while i < len(lines):
                cur = lines[i].strip()
                bm = BULLET_RE.match(cur) if style == "bullet" else NUMBER_RE.match(cur)
                if not bm:
                    break
                raw = bm.group(1) if style == "bullet" else bm.group(2)
                item: dict[str, Any] = {"text": plain(raw)}
                em = emphasis_spans(raw)
                if em:
                    item["emphasis"] = em
                items.append(item)
                i += 1
            blocks.append({"type": "list", "style": style, "items": items})
            continue

        para_buf.append(stripped)
        i += 1

    flush_para()
    return blocks


def to_plain_text(blocks: list[dict], image_marker: bool = True) -> str:
    """
    편집기에 붙여넣을 순수 텍스트를 만듭니다.
    숨은 태그가 전혀 없는 평범한 글자만 남습니다.
    """
    out: list[str] = []
    for b in blocks:
        kind = b["type"]
        if kind == "paragraph":
            out.append(b["text"])
        elif kind == "heading":
            out.append(b["text"])
        elif kind == "image":
            if image_marker:
                cap = f"  (설명: {b['caption']})" if b.get("caption") else ""
                out.append(f"▶ 이미지 {b['index']} 넣기 → {b['file']}{cap}")
        elif kind == "list":
            for n, item in enumerate(b["items"], 1):
                bullet = "· " if b["style"] == "bullet" else f"{n}. "
                out.append(bullet + item["text"])
        elif kind == "divider":
            out.append("─────────")
        elif kind == "quote":
            out.append(b["text"])
        elif kind == "hashtags":
            out.append(" ".join("#" + t for t in b["tags"]))
        out.append("")
    return "\n".join(out).strip() + "\n"


def summary(blocks: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for b in blocks:
        counts[b["type"]] = counts.get(b["type"], 0) + 1
    return counts
