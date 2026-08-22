# -*- coding: utf-8 -*-
"""
내 블로그 글 가져오기 — 양식 분석에 쓸 표본을 모읍니다.

  네이버 블로그가 공개로 제공하는 RSS 를 읽어 최근 글 목록을 받고,
  각 글의 공개 주소에서 본문을 가져와 samples/ 에 저장합니다.

  · 내 블로그의 공개 글만 가져옵니다. 로그인하지 않습니다.
  · 비공개 글은 가져올 수 없습니다. (그게 맞습니다)
  · 네이버에 무리를 주지 않도록 글 사이에 잠깐씩 쉽니다.
  · 추가 설치가 필요 없습니다. 파이썬 기본 기능만 씁니다.

실행
  python scripts/fetch_samples.py                 두 채널 각 10편
  python scripts/fetch_samples.py --channel stock --count 5
"""
from __future__ import annotations

import argparse
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c              # noqa: E402
from scripts import naverhtml                # noqa: E402
from scripts import textutil as t            # noqa: E402

SAMPLES_DIR = c.PROJECT_ROOT / "samples"
RSS_URL = "https://rss.blog.naver.com/{blog_id}.xml"
# 모바일 쪽이 화면이 단순해서 본문을 읽기 좋습니다.
MOBILE_URL = "https://m.blog.naver.com/{blog_id}/{log_no}"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
PAUSE = 1.5          # 글 사이 쉬는 시간(초)
TIMEOUT = 20


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "ko-KR,ko;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read()
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def fetch_feed(blog_id: str, count: int) -> list[dict]:
    """공개 RSS 에서 최근 글 목록을 받습니다."""
    xml = get(RSS_URL.format(blog_id=blog_id))
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as e:
        raise RuntimeError(f"RSS 를 읽지 못했습니다: {e}")

    items = []
    for item in root.iter("item"):
        def txt(tag: str) -> str:
            el = item.find(tag)
            return (el.text or "").strip() if el is not None else ""
        link = txt("link")
        m = re.search(r"/(\d{6,})", link)
        items.append({
            "title": txt("title"),
            "link": link,
            "log_no": m.group(1) if m else "",
            "date": txt("pubDate"),
            "category": txt("category"),
        })
        if len(items) >= count:
            break
    return items


def normalize_date(raw: str) -> str:
    """RSS 날짜를 YYYY-MM-DD 로. 못 읽으면 원문 그대로."""
    m = re.search(r"(\d{1,2})\s+(\w{3})\s+(\d{4})", raw)
    if m:
        months = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                  "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
        mo = months.get(m.group(2))
        if mo:
            return f"{m.group(3)}-{mo:02d}-{int(m.group(1)):02d}"
    m = re.search(r"(\d{4})[-.](\d{1,2})[-.](\d{1,2})", raw)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return raw[:20] or "날짜미상"


def save_sample(ch_key: str, no: int, item: dict, parsed: dict,
                raw_html: str, keep_raw: bool) -> Path:
    date = normalize_date(item["date"])
    # 제목이 한글이면 영문 파일명으로 바꿀 수 없습니다.
    # 그래서 네이버 글 번호를 씁니다. 주소로 바로 되짚을 수 있어 편합니다.
    ident = item["log_no"] or c.safe_filename(item["title"], fallback=f"post{no}")
    out_dir = SAMPLES_DIR / ch_key
    c.ensure_dir(out_dir)
    path = out_dir / f"{no:02d}-{date}-{ident}.md"

    body_md = naverhtml.blocks_to_markdown(parsed["blocks"])
    prose = "\n".join(b.get("text", "") for b in parsed["blocks"]
                      if b["type"] in ("paragraph", "heading", "quote"))
    sents = t.sentences(prose)
    avg = (sum(t.char_count(s) for s in sents) // len(sents)) if sents else 0
    heads = [b["text"] for b in parsed["blocks"] if b["type"] == "heading"]

    front = [
        "---",
        f'source_url: "{item["link"]}"',
        f'blog_id: "{ch_key}"',
        f'title: "{(parsed.get("title") or item["title"]).replace(chr(34), chr(39))}"',
        f'published: "{date}"',
        f'category: "{parsed.get("category") or item.get("category") or ""}"',
        f"fetched_at: \"{c.now_kst():%Y-%m-%d %H:%M} KST\"",
        "",
        "# 자동으로 재어 본 값 (분석에 씁니다)",
        f"title_chars: {len(parsed.get('title') or item['title'])}",
        f"body_chars: {t.char_count(prose)}",
        f"sentence_count: {len(sents)}",
        f"avg_sentence_chars: {avg}",
        f"heading_count: {len(heads)}",
        f"image_count: {len(parsed['images'])}",
        f"tag_count: {len(parsed['tags'])}",
        f"tags: [{', '.join(parsed['tags'])}]",
        "headings:",
    ]
    front += [f'  - "{h}"' for h in heads] or ["  []"]
    front += [
        "images:",
    ]
    front += [f'  - alt: "{(im.get("alt") or "").replace(chr(34), chr(39))}"'
              for im in parsed["images"]] or ["  []"]
    front.append("---")
    front.append("")

    c.write_text(path, "\n".join(front) + body_md)

    if keep_raw:
        raw_dir = c.ensure_dir(out_dir / "_raw")
        c.write_text(raw_dir / f"{no:02d}-{ident}.html", raw_html)
    return path


def fetch_channel(ch_key: str, count: int, keep_raw: bool) -> list[Path]:
    ch = c.get_channel(ch_key)
    blog_id = ch["blog_id"]
    c.say()
    c.say(f"  ── {ch['name']} ({blog_id}) ──")

    try:
        items = fetch_feed(blog_id, count)
    except urllib.error.HTTPError as e:
        c.error(f"RSS 를 가져오지 못했습니다 (HTTP {e.code}).")
        c.say(f"      주소를 확인해 주세요: {RSS_URL.format(blog_id=blog_id)}")
        return []
    except urllib.error.URLError as e:
        c.error(f"인터넷 연결 문제로 실패했습니다: {e.reason}")
        c.say("      회사 방화벽이 막고 있을 수도 있습니다.")
        return []
    except Exception as e:
        c.error(f"RSS 를 읽지 못했습니다: {e}")
        return []

    if not items:
        c.warn("RSS 에 글이 없습니다. 블로그가 비공개이거나 글이 없을 수 있습니다.")
        return []

    c.info(f"글 {len(items)}편을 찾았습니다. 하나씩 가져옵니다 …")
    saved: list[Path] = []

    for i, item in enumerate(items, 1):
        title = c.clip(item["title"], 40)
        url = (MOBILE_URL.format(blog_id=blog_id, log_no=item["log_no"])
               if item["log_no"] else item["link"])
        try:
            raw = get(url)
            parsed = naverhtml.parse_post(raw)
            if not parsed["blocks"]:
                c.warn(f"{i:2d}. {title} — 본문을 읽지 못했습니다. 건너뜁니다.")
                continue
            p = save_sample(ch_key, i, item, parsed, raw, keep_raw)
            saved.append(p)
            c.ok(f"{i:2d}. {title}  (이미지 {len(parsed['images'])}장)")
        except urllib.error.HTTPError as e:
            c.warn(f"{i:2d}. {title} — 가져오지 못했습니다 (HTTP {e.code})")
        except Exception as e:
            c.warn(f"{i:2d}. {title} — {type(e).__name__}: {e}")
        time.sleep(PAUSE)

    return saved


def write_index(results: dict[str, list[Path]]) -> Path:
    lines = [
        "# 수집한 블로그 글",
        "",
        f"가져온 시각: {c.now_kst():%Y-%m-%d %H:%M} KST",
        "",
        "> Claude Code 에게 이렇게 말하면 양식을 분석해 반영합니다.",
        "> ```",
        "> samples/ 폴더의 글을 분석해서 config/style_coin.md 와",
        "> config/style_stock.md 를 채워줘",
        "> ```",
        "",
    ]
    for ch_key, paths in results.items():
        if not paths:
            continue
        ch = c.get_channel(ch_key)
        lines += [f"## {ch['name']} ({ch['blog_id']}) — {len(paths)}편", ""]
        lines += ["| # | 파일 | 제목 |", "|---|---|---|"]
        for i, p in enumerate(paths, 1):
            title = ""
            for line in c.read_text(p).splitlines()[:8]:
                if line.startswith("title:"):
                    title = line.split(":", 1)[1].strip().strip('"')
                    break
            lines.append(f"| {i} | `{p.name}` | {c.clip(title, 46)} |")
        lines.append("")
    lines += [
        "## 각 파일에 들어 있는 것",
        "",
        "맨 위에 자동으로 재어 본 값이 있습니다.",
        "",
        "| 항목 | 뜻 |",
        "|---|---|",
        "| `title_chars` | 제목 글자 수 |",
        "| `body_chars` | 본문 글자 수 (공백 제외) |",
        "| `avg_sentence_chars` | 문장 하나의 평균 길이 |",
        "| `heading_count` / `headings` | 소제목 개수와 목록 |",
        "| `image_count` / `images` | 이미지 개수와 설명 |",
        "| `tags` | 해시태그 |",
        "",
        "그 아래는 본문입니다. 이미지 자리는 `[이미지1]` 처럼 표시했습니다.",
        "",
        "> `_raw/` 폴더에는 원본 HTML 이 들어 있습니다.",
        "> 용량이 커서 동기화하지 않습니다. 지우셔도 됩니다.",
        "",
    ]
    return c.write_text(SAMPLES_DIR / "README.md", "\n".join(lines))


def main() -> None:
    ap = argparse.ArgumentParser(description="내 블로그의 공개 글을 가져옵니다.")
    ap.add_argument("--channel", choices=["coin", "stock", "all"], default="all")
    ap.add_argument("--count", type=int, default=10, help="채널당 가져올 글 수")
    ap.add_argument("--keep-raw", action="store_true", default=True,
                    help="원본 HTML 도 보관합니다 (기본값)")
    ap.add_argument("--no-raw", dest="keep_raw", action="store_false")
    args = ap.parse_args()

    c.header("블로그 글 가져오기")
    c.say()
    c.say("  내 블로그의 공개 글만 가져옵니다. 로그인하지 않습니다.")
    c.say("  비공개 글은 가져올 수 없습니다.")

    targets = ["coin", "stock"] if args.channel == "all" else [args.channel]
    results = {k: fetch_channel(k, args.count, args.keep_raw) for k in targets}

    total = sum(len(v) for v in results.values())
    c.say()
    if not total:
        c.warn("가져온 글이 없습니다.")
        c.say()
        c.say("  이럴 때 확인해 보세요:")
        c.say("    · 인터넷이 되는지 (회사 방화벽이 막을 수 있습니다)")
        c.say("    · 블로그가 공개로 되어 있는지")
        c.say("    · config/channel_profiles.yaml 의 blog_id 가 맞는지")
        c.say()
        c.say("  안 되면 글 본문을 복사해서 Claude Code 에 붙여넣으셔도 됩니다.")
        return

    idx = write_index(results)
    c.ok(f"글 {total}편을 가져왔습니다.")
    c.ok(f"목록: {c.rel(idx)}")
    c.say()
    c.say("  ┌─────────────────────────────────────────────────────┐")
    c.say("  │  이제 Claude Code 에게 아래 문장을 그대로 말하세요. │")
    c.say("  └─────────────────────────────────────────────────────┘")
    c.say()
    c.say("    samples/ 폴더의 글을 분석해서 style_coin.md 와")
    c.say("    style_stock.md 를 채워줘")
    c.say()
    c.get_logger().info(f"샘플 수집: {total}편")


if __name__ == "__main__":
    main()
