# -*- coding: utf-8 -*-
"""
네이버 블로그 글 HTML 을 읽을 수 있는 글로 바꿉니다.

  바깥 라이브러리를 쓰지 않습니다. 파이썬에 들어 있는 것만 씁니다.
  (회사 PC에서 추가 설치가 막혀 있어도 동작하도록)

  스마트에디터 ONE 은 글을 se-component 라는 덩어리로 나눠 담습니다.
    se-text     문단·소제목
    se-image    이미지
    se-quotation 인용
    se-horizontalLine 구분선
  이 덩어리를 알아보면 원래 구조를 꽤 정확히 되살릴 수 있습니다.
  구조를 못 알아보면 그냥 글자만 뽑아 냅니다.
"""
from __future__ import annotations

import html
import re
from html.parser import HTMLParser

BLOCK_TAGS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "blockquote"}
DROP_TAGS = {"script", "style", "noscript", "head"}

# 소제목으로 볼 만한 신호
HEADING_HINTS = ("se-section-documentTitle", "se_textarea_title",
                 "se-title-text", "se-fs-fs32", "se-fs-fs30", "se-fs-fs28")


class NaverPostParser(HTMLParser):
    """글 본문을 블록 목록으로 뽑아 냅니다."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self._buf: list[str] = []
        self._drop_depth = 0
        self._kind = "paragraph"      # 지금 모으고 있는 덩어리의 종류
        self._depth_stack: list[tuple[int, str]] = []
        self._depth = 0
        self.title: str | None = None
        self.tags: list[str] = []

    # ── 도우미 ────────────────────────────────────────────
    def _flush(self) -> None:
        text = re.sub(r"[ \t]+", " ", "".join(self._buf)).strip()
        text = re.sub(r"\n{2,}", "\n", text)
        self._buf = []
        if not text:
            return
        self.blocks.append({"type": self._kind, "text": text})

    # ── 태그 ──────────────────────────────────────────────
    def handle_starttag(self, tag, attrs):
        self._depth += 1
        a = dict(attrs)
        cls = a.get("class", "") or ""

        if tag in DROP_TAGS:
            self._drop_depth += 1
            return
        if self._drop_depth:
            return

        if tag == "img":
            src = a.get("src") or a.get("data-lazy-src") or ""
            alt = (a.get("alt") or "").strip()
            # 아이콘·이모티콘 같은 아주 작은 것은 본문 이미지가 아닙니다.
            if "se-sticker" in cls or "emoticon" in src:
                return
            self._flush()
            self.blocks.append({"type": "image", "src": src, "alt": alt})
            return

        if tag == "hr" or "se-horizontalLine" in cls:
            self._flush()
            self.blocks.append({"type": "divider", "text": ""})
            return

        # 덩어리 시작 — 종류를 정합니다
        if "se-component" in cls or tag in ("h1", "h2", "h3", "h4", "blockquote"):
            self._flush()
            if any(h in cls for h in HEADING_HINTS) or tag in ("h1", "h2", "h3", "h4"):
                self._kind = "heading"
            elif "se-quotation" in cls or tag == "blockquote":
                self._kind = "quote"
            else:
                self._kind = "paragraph"
            self._depth_stack.append((self._depth, self._kind))
            return

        if tag == "br":
            self._buf.append("\n")

    def handle_endtag(self, tag):
        if tag in DROP_TAGS and self._drop_depth:
            self._drop_depth -= 1
        elif not self._drop_depth:
            if tag in BLOCK_TAGS:
                self._flush()
            while self._depth_stack and self._depth_stack[-1][0] >= self._depth:
                self._depth_stack.pop()
                self._kind = self._depth_stack[-1][1] if self._depth_stack else "paragraph"
        self._depth = max(0, self._depth - 1)

    def handle_data(self, data):
        if self._drop_depth:
            return
        if data.strip():
            self._buf.append(data)
        elif self._buf and not self._buf[-1].endswith((" ", "\n")):
            self._buf.append(" ")

    def close(self):
        super().close()
        self._flush()


def _meta(html_text: str, *names: str) -> str | None:
    for n in names:
        m = re.search(
            r'<meta[^>]+(?:property|name)=["\']' + re.escape(n) +
            r'["\'][^>]+content=["\']([^"\']*)["\']', html_text, re.I)
        if not m:
            m = re.search(
                r'<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']'
                + re.escape(n) + r'["\']', html_text, re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return None


CONTAINER_PATTERNS = [
    r'<div[^>]+class="[^"]*se-main-container[^"]*"[^>]*>',   # 스마트에디터 ONE
    r'<div[^>]+id="postViewArea"[^>]*>',                      # 구 에디터
    r'<div[^>]+class="[^"]*post-view[^"]*"[^>]*>',
    r'<div[^>]+class="[^"]*se_component_wrap[^"]*"[^>]*>',
]


def _extract_container(html_text: str) -> str:
    """
    본문 영역만 잘라 냅니다.

    <div> 안에 <div> 가 여러 겹 들어 있어서
    정규식 하나로는 끝을 제대로 찾을 수 없습니다.
    그래서 여는 태그와 닫는 태그의 개수를 세어 짝이 맞는 곳에서 끊습니다.
    """
    for pat in CONTAINER_PATTERNS:
        m = re.search(pat, html_text, re.I)
        if not m:
            continue
        start = m.start()
        depth = 0
        for tm in re.finditer(r"<\s*(/?)div\b", html_text[start:], re.I):
            depth += -1 if tm.group(1) else 1
            if depth == 0:
                return html_text[start:start + tm.end()]
        # 짝이 안 맞으면 그 지점부터 끝까지
        return html_text[start:]
    return html_text


def _dedupe_dividers(blocks: list[dict]) -> list[dict]:
    """
    구분선이 연달아 나오면 하나로 합칩니다.
    네이버는 구분선을 <div class="se-horizontalLine"> 와 그 안의 <hr> 로
    두 번 표시해서, 그대로 두면 줄이 두 개로 보입니다.
    """
    out: list[dict] = []
    for b in blocks:
        if b["type"] == "divider" and out and out[-1]["type"] == "divider":
            continue
        out.append(b)
    # 맨 앞뒤의 구분선은 의미가 없으므로 뺍니다.
    while out and out[0]["type"] == "divider":
        out.pop(0)
    while out and out[-1]["type"] == "divider":
        out.pop()
    return out


def parse_post(html_text: str) -> dict:
    """
    글 HTML 하나를 {title, blocks, images, tags, category} 로 바꿉니다.
    """
    title = _meta(html_text, "og:title", "twitter:title")

    body = _extract_container(html_text)

    p = NaverPostParser()
    try:
        p.feed(body)
        p.close()
    except Exception:
        pass

    blocks = _dedupe_dividers(p.blocks)
    # 제목이 본문 첫 줄에 그대로 있으면 뺍니다.
    if title and blocks and blocks[0].get("text", "").strip() == title.strip():
        blocks = blocks[1:]

    # 태그 — 네이버는 태그 링크에 tagName= 을 씁니다.
    tags = []
    for m in re.finditer(r'tagName=([^"&\']+)', html_text):
        from urllib.parse import unquote
        t = unquote(m.group(1)).strip()
        if t and t not in tags:
            tags.append(t)
    if not tags:
        tags = [t.lstrip("#") for t in re.findall(r"(?<!\w)#([가-힣A-Za-z0-9_]{2,})",
                                                  " ".join(b.get("text", "") for b in blocks))]

    images = [b for b in blocks if b["type"] == "image"]
    category = _meta(html_text, "og:article:section") or None

    return {
        "title": title,
        "blocks": blocks,
        "images": images,
        "tags": tags[:20],
        "category": category,
    }


def blocks_to_markdown(blocks: list[dict]) -> str:
    """뽑아 낸 블록을 읽기 좋은 글로 바꿉니다."""
    out: list[str] = []
    img_no = 0
    for b in blocks:
        k = b["type"]
        if k == "image":
            img_no += 1
            alt = b.get("alt") or ""
            out.append(f"[이미지{img_no}]" + (f" (설명: {alt})" if alt else ""))
        elif k == "heading":
            out.append(f"## {b['text']}")
        elif k == "quote":
            out.append("> " + b["text"].replace("\n", "\n> "))
        elif k == "divider":
            out.append("---")
        else:
            out.append(b["text"])
        out.append("")
    return "\n".join(out).strip() + "\n"
