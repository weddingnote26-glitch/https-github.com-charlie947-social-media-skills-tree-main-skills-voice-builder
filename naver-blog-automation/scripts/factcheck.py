# -*- coding: utf-8 -*-
"""
사실 확인 — 본문에 쓴 수치가 출처로 뒷받침되는지 검사합니다.

핵심 원칙
  본문에 나온 금액·지수·환율·금리·비율 같은 수치는
  sources.md 의 '확인한 수치' 표에 **교차확인 ✓** 로 올라와 있어야 합니다.
  올라와 있지 않으면 그 수치는 본문에서 빼거나 `확인 필요` 로 바꿔야 합니다.

  이 검사는 인터넷 없이도 동작합니다. 자료를 대신 찾아주지는 않고,
  '근거 없는 수치가 본문에 남아 있는지' 를 막는 역할을 합니다.

실행:  python scripts/factcheck.py [--week 2026-W36] [--post <게시물ID>]
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts.postfile import PostFile      # noqa: E402

# ── 돈·지표를 나타내는 단위 ────────────────────────────────
UNITS = r"(?:원|달러|엔|위안|유로|%|퍼센트|포인트|bp|배)"

# 숫자 + 단위.
#   · 쉼표와 소수점을 허용합니다.            (2,650 / 3.5)
#   · 한국식 복합 숫자를 한 덩어리로 봅니다.  (9만 5,000달러 / 1조 2,000억원)
CLAIM_RE = re.compile(
    r"(?<![\w가-힣])"
    r"("
    r"(?:\d[\d,]*(?:\.\d+)?\s*[조억만]\s*)*"   # 앞자리: 9만 / 1조 2,000억 …
    r"\d[\d,]*(?:\.\d+)?\s*[조억만]?\s*"       # 끝자리 숫자 (+ 만/억/조)
    + UNITS +
    r")"
)

# 수치처럼 보이지만 검사에서 빼는 것들
SKIP_PATTERNS = [
    re.compile(r"자료\s*기준"),
    re.compile(r"확인\s*필요"),
    re.compile(r"^\s*\|"),          # 표 안 (sources 표는 따로 검사)
]

# "이건 실제 수치가 아니라 설명을 위한 예시입니다" 라는 신호
EXAMPLE_MARKERS = [
    "예를 들", "예로 들", "예시", "가정", "만약",
    # '~라고 해 봅시다' 뿐 아니라 '벌었다고 해 봅시다' 같은 형태도 잡습니다.
    "고 해 봅", "고 해 볼게", "고 치면", "쳐 봅시다", "쳐 볼게",
    "가상의", "임의로", "가령", "셈 치",
]

# 날짜 표현 안의 숫자는 수치 주장이 아닙니다.
DATE_RE = re.compile(r"\d{4}\s*년|\d{1,2}\s*월|\d{1,2}\s*일|\d{4}-\d{2}-\d{2}")

HEADING_RE = re.compile(r"^\s*#{1,6}\s")


def extract_claims(text: str, strict: bool = True) -> list[tuple[int, str, str]]:
    """
    본문에서 '출처가 필요한 수치' 를 뽑습니다.

    설명을 위해 든 예시 숫자(예: "자기 돈 1억 원을 넣었다고 해 봅시다")는
    실제 시세가 아니므로 출처를 요구하지 않습니다.
    '예를 들어' 같은 신호가 나오면 그 뒤의 숫자를 예시로 봅니다.

      strict=True  (시황·뉴스 글)
          예시 범위를 문단 하나로 좁게 잡습니다. 빈 줄이 나오면 풀립니다.
          실제 시세를 예시로 위장해 넘어가는 일을 막기 위함입니다.
      strict=False (용어·개념 설명 글)
          예시 범위를 그 소제목 안으로 넓게 잡습니다.
          가르치는 글은 예시가 여러 문단에 걸쳐 이어지기 때문입니다.

    반환: [(줄번호, 수치, 그 줄 전체), ...]
    """
    found: list[tuple[int, str, str]] = []
    in_example = False

    for lineno, line in enumerate(text.splitlines(), 1):
        # 새 소제목이 나오면 예시 범위가 끝납니다.
        if HEADING_RE.match(line):
            in_example = False
            continue

        if not line.strip():
            if strict:          # 엄격 모드에서는 문단이 끝나면 바로 풀립니다.
                in_example = False
            continue

        if any(p.search(line) for p in SKIP_PATTERNS):
            continue

        if any(m in line for m in EXAMPLE_MARKERS):
            in_example = True
            continue            # 신호가 있는 줄 자체도 건너뜁니다.

        if in_example:
            continue

        stripped = DATE_RE.sub("", line)
        for m in CLAIM_RE.finditer(stripped):
            found.append((lineno, m.group(1).strip(), line.strip()))
    return found


def parse_sources_table(path: Path) -> list[dict]:
    """
    sources.md 의 '확인한 수치' 표를 읽습니다.
    | 항목 | 값 | 출처 1 | 출처 2 | 교차확인 | 확인일시 |
    """
    if not path.exists():
        return []
    rows: list[dict] = []
    in_table = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("## 확인한 수치"):
            in_table = True
            continue
        if in_table and line.strip().startswith("## "):
            break
        if not in_table or not line.strip().startswith("|"):
            continue
        cells = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(cells) < 6:
            continue
        if cells[0] in ("항목", "") or set(cells[0]) <= {"-", ":"}:
            continue
        rows.append({
            "item": cells[0], "value": cells[1],
            "source1": cells[2], "source2": cells[3],
            "verified": cells[4], "checked_at": cells[5],
        })
    return rows


def _digits(s: str) -> str:
    return re.sub(r"[^\d]", "", s)


def is_backed(claim: str, rows: list[dict], min_sources: int) -> bool:
    """이 수치가 출처 표에서 교차확인된 값과 맞아떨어지는가."""
    target = _digits(claim)
    if not target:
        return False
    for r in rows:
        if _digits(r["value"]) != target:
            continue
        if "✓" not in r["verified"] and r["verified"].lower() not in ("o", "ok", "예"):
            continue
        n = sum(1 for k in ("source1", "source2")
                if r[k] and r[k] not in ("–", "-", ""))
        if n >= min_sources:
            return True
    return False


# ──────────────────────────────────────────────────────────────
def check_post(pdir: Path, settings: dict) -> dict:
    """게시물 하나를 검사합니다."""
    post_path = pdir / "post.md"
    result = {"dir": pdir, "ok": False, "unbacked": [], "notes": [], "claims": 0}

    if not post_path.exists():
        result["notes"].append("원고(post.md)가 아직 없습니다.")
        return result

    post = PostFile.load(post_path)
    fc = settings.get("factcheck") or {}
    min_sources = int(fc.get("min_sources", 2))

    rows = parse_sources_table(pdir / "sources.md")

    # 시황·뉴스처럼 실시간 자료를 쓰는 글은 엄격하게 검사합니다.
    meta_early = c.read_yaml(pdir / "metadata.yaml", default={}) or {}
    slot_name = str(meta_early.get("slot", ""))
    live = bool(re.search(r"시황|일정|뉴스|이슈|복습", slot_name))
    claims = extract_claims(post.prose(), strict=live)
    result["claims"] = len(claims)

    seen: set[str] = set()
    for lineno, claim, line in claims:
        if claim in seen:
            continue
        seen.add(claim)
        if not is_backed(claim, rows, min_sources):
            result["unbacked"].append({"line": lineno, "value": claim, "text": line})

    # 시황 글이면 자료 기준 시각이 있어야 합니다.
    asof = post.get("data_asof")
    if live and not asof:
        result["notes"].append(
            "시황·뉴스 글인데 자료 기준 시각(data_asof)이 비어 있습니다."
        )
    if asof and "KST" not in str(asof) and "한국" not in str(asof):
        result["notes"].append(
            f"자료 기준 시각에 시간대 표시가 없습니다: {asof} (예: 2026-08-24 07:00 KST)"
        )

    if not (pdir / "sources.md").exists():
        result["notes"].append("sources.md 가 없습니다.")
    elif not rows and claims:
        result["notes"].append("sources.md 의 '확인한 수치' 표가 비어 있습니다.")

    result["ok"] = not result["unbacked"] and not result["notes"]
    return result


def apply_status(pdir: Path, ok: bool) -> None:
    """검사를 통과하면 상태를 fact_checked 로 올립니다."""
    if not ok:
        return
    meta_path = pdir / "metadata.yaml"
    meta = c.read_yaml(meta_path, default={}) or {}
    if meta.get("status") != "draft":
        return
    meta["status"] = "fact_checked"
    meta.setdefault("sources", {})
    meta["sources"]["verified"] = True
    meta.setdefault("history", []).append({
        "status": "fact_checked",
        "at": c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST"),
        "by": "factcheck.py",
        "note": "본문 수치가 모두 출처로 뒷받침됨",
    })
    c.write_yaml(meta_path, meta)

    post_path = pdir / "post.md"
    if post_path.exists():
        post = PostFile.load(post_path)
        post.front["status"] = "fact_checked"
        post.front["sources_verified"] = True
        post.save()


# ──────────────────────────────────────────────────────────────
def iter_posts(wdir: Path, post_id: str | None):
    for ch_dir in sorted(p for p in wdir.iterdir() if p.is_dir()):
        for day_dir in sorted(p for p in ch_dir.iterdir() if p.is_dir()):
            if post_id:
                meta = c.read_yaml(day_dir / "metadata.yaml", default={}) or {}
                if meta.get("post_id") != post_id:
                    continue
            yield day_dir


def main() -> None:
    ap = argparse.ArgumentParser(description="본문 수치가 출처로 뒷받침되는지 검사합니다.")
    ap.add_argument("--week", help="주차 (예: 2026-W36)")
    ap.add_argument("--post", help="게시물 ID 하나만")
    args = ap.parse_args()

    try:
        settings = c.load_settings()
    except c.ConfigError as e:
        c.error(str(e))
        raise SystemExit(1)

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)

    c.header(f"{wdir.name} 사실 확인")

    total = passed = 0
    for pdir in iter_posts(wdir, args.post):
        if not (pdir / "post.md").exists():
            continue
        total += 1
        r = check_post(pdir, settings)
        name = f"{pdir.parent.name}/{pdir.name}"

        if r["ok"]:
            apply_status(pdir, True)
            c.ok(f"{name} — 수치 {r['claims']}건 모두 확인됨")
            passed += 1
            continue

        c.warn(f"{name} — 손볼 곳이 있습니다.")
        for note in r["notes"]:
            c.say(f"      · {note}")
        for u in r["unbacked"]:
            c.say(f"      · {u['line']}번째 줄 「{u['value']}」 — 출처가 없습니다.")
            c.say(f"        → sources.md 표에 추가하거나, 본문에서 `확인 필요` 로 바꾸세요.")

    c.say()
    if total == 0:
        c.warn("검사할 원고가 없습니다. 먼저 원고를 써 주세요.")
    else:
        c.ok(f"{total}편 중 {passed}편이 사실 확인을 통과했습니다.")
    c.get_logger().info(f"사실확인 {wdir.name}: {passed}/{total}")


if __name__ == "__main__":
    main()
