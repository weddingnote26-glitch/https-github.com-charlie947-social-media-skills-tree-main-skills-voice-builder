# -*- coding: utf-8 -*-
"""
이미지 만들기 — 표와 간단한 차트를 직접 그립니다.

지키는 것
  · 뉴스 사진을 가져다 쓰지 않습니다. 직접 그린 것만 씁니다.
  · 차트에 넣는 숫자는 sources.md 에서 교차확인된 값만 씁니다.
    확인되지 않은 숫자로는 차트를 만들지 않습니다.
  · 파일명은 영문과 숫자로만 만듭니다.
  · 채널마다 색을 다르게 해서 분위기를 지킵니다.

차트 데이터는 image_prompts.md 안에 이렇게 적습니다.

    ## 1. btc-weekly-01.png
    - **종류**: 차트
    - **차트유형**: bar        (bar 또는 line)
    - **제목**: 주요 코인 주간 등락률
    - **차트 데이터**:
      ```
      항목,값,출처
      비트코인,3.2,CoinGecko/업비트
      이더리움,1.8,CoinGecko/업비트
      ```

실행:  python scripts/make_images.py [--week 2026-W36] [--post <게시물ID>]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts.factcheck import parse_sources_table, _digits   # noqa: E402

# Windows / macOS / Linux 에서 한글이 깨지지 않는 글꼴 후보
KO_FONTS = ["Malgun Gothic", "맑은 고딕", "AppleGothic", "NanumGothic",
            "Noto Sans CJK KR", "Noto Sans KR", "DejaVu Sans"]

BLOCK_RE = re.compile(
    r"^##\s+\d+\.\s*(?P<file>\S+)\s*$(?P<body>.*?)(?=^##\s+\d+\.|\Z)",
    re.M | re.S,
)
FIELD_RE = re.compile(r"^\s*-\s*\*\*(?P<k>[^*]+)\*\*\s*:\s*(?P<v>.*?)\s*$", re.M)
DATA_RE = re.compile(r"```\s*\n(?P<data>.*?)\n\s*```", re.S)


def parse_specs(path: Path) -> list[dict]:
    """image_prompts.md 에서 이미지 명세를 읽습니다."""
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    specs = []
    for m in BLOCK_RE.finditer(text):
        body = m.group("body")
        fields = {f.group("k").strip(): f.group("v").strip()
                  for f in FIELD_RE.finditer(body)}
        rows = []
        for dm in DATA_RE.finditer(body):
            for line in dm.group("data").strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 2 and parts[0] not in ("항목", ""):
                    rows.append(parts)
        specs.append({
            "file": m.group("file").strip(),
            "kind": fields.get("종류", ""),
            "chart_type": fields.get("차트유형", "bar"),
            "title": fields.get("제목", ""),
            "alt": fields.get("대체 텍스트", ""),
            "rows": rows,
        })
    return specs


def verified_values(pdir: Path) -> set[str]:
    """sources.md 에서 교차확인이 끝난 값들(숫자만)."""
    out = set()
    for r in parse_sources_table(pdir / "sources.md"):
        if "✓" in r["verified"] or r["verified"].lower() in ("o", "ok", "예"):
            d = _digits(r["value"])
            if d:
                out.add(d)
    return out


def pick_font():
    from matplotlib import font_manager
    available = {f.name for f in font_manager.fontManager.ttflist}
    for name in KO_FONTS:
        if name in available:
            return name
    return None


def draw(spec: dict, pdir: Path, design: dict) -> Path | None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    font = pick_font()
    if font:
        plt.rcParams["font.family"] = font
    plt.rcParams["axes.unicode_minus"] = False

    primary = design.get("primary_color", "#2B6CB0")
    accent = design.get("accent_color", "#F6AD55")

    labels = [r[0] for r in spec["rows"]]
    try:
        values = [float(r[1].replace(",", "").replace("%", "")) for r in spec["rows"]]
    except ValueError:
        c.warn(f"{spec['file']} — 숫자로 바꿀 수 없는 값이 있어 건너뜁니다.")
        return None

    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=150)
    fig.patch.set_facecolor("white")

    if spec["chart_type"].lower() == "line":
        ax.plot(labels, values, marker="o", color=primary, linewidth=2.5)
    else:
        colors = [primary if v >= 0 else accent for v in values]
        bars = ax.bar(labels, values, color=colors, width=0.6)
        for b, v in zip(bars, values):
            ax.annotate(f"{v:g}", (b.get_x() + b.get_width() / 2, v),
                        ha="center", va="bottom" if v >= 0 else "top",
                        fontsize=10, color="#333")

    ax.set_title(spec["title"] or spec["file"], fontsize=14,
                 color=primary, pad=14, fontweight="bold")
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color("#CBD5E0")
    ax.grid(axis="y", color="#EDF2F7", linewidth=1)
    ax.set_axisbelow(True)
    ax.tick_params(colors="#4A5568")
    fig.tight_layout()

    out = pdir / "images" / spec["file"]
    c.ensure_dir(out.parent)
    fig.savefig(out, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return out


def process(pdir: Path) -> tuple[int, int]:
    specs = parse_specs(pdir / "image_prompts.md")
    charts = [s for s in specs if s["rows"]]
    if not charts:
        return 0, 0

    ch = c.get_channel(pdir.parent.name)
    ok_values = verified_values(pdir)
    made = skipped = 0

    for spec in charts:
        # 검증되지 않은 숫자로는 차트를 만들지 않습니다.
        unverified = [r[0] for r in spec["rows"]
                      if _digits(r[1]) and _digits(r[1]) not in ok_values]
        if unverified and ok_values:
            c.warn(f"{spec['file']} — 출처 확인이 안 된 값이 있어 만들지 않았습니다: "
                   f"{', '.join(unverified[:3])}")
            skipped += 1
            continue
        if unverified and not ok_values:
            c.warn(f"{spec['file']} — sources.md 에 교차확인된 수치가 없습니다. "
                   f"차트를 만들지 않았습니다.")
            skipped += 1
            continue

        p = draw(spec, pdir, ch.get("design", {}))
        if p:
            c.ok(c.rel(p))
            made += 1
    return made, skipped


def main() -> None:
    ap = argparse.ArgumentParser(description="표·차트 이미지를 만듭니다.")
    ap.add_argument("--week")
    ap.add_argument("--post")
    args = ap.parse_args()

    try:
        import matplotlib  # noqa: F401
    except ImportError:
        c.header("이미지 만들기")
        c.warn("matplotlib 이 설치되어 있지 않아 차트를 만들 수 없습니다.")
        c.say()
        c.say("      설치하려면:  pip install matplotlib")
        c.say()
        c.say("      설치하지 않아도 나머지 기능은 모두 동작합니다.")
        c.say("      이미지는 직접 만들어 images/ 폴더에 넣어 주세요.")
        return

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)
    c.header(f"{wdir.name} 이미지 만들기")

    if not pick_font():
        c.warn("한글 글꼴을 찾지 못했습니다. 차트의 한글이 깨질 수 있습니다.")
        c.say("      Windows에서는 보통 '맑은 고딕'이 이미 있습니다.")

    total_made = total_skipped = 0
    for ip in sorted(wdir.rglob("image_prompts.md")):
        if args.post:
            meta = c.read_yaml(ip.parent / "metadata.yaml", default={}) or {}
            if meta.get("post_id") != args.post:
                continue
        m, s = process(ip.parent)
        total_made += m
        total_skipped += s

    c.say()
    c.ok(f"이미지 {total_made}개를 만들었습니다. (건너뜀 {total_skipped}개)")
    if total_skipped:
        c.say("      건너뛴 것은 출처 확인이 끝나면 다시 실행해 주세요.")


if __name__ == "__main__":
    main()
