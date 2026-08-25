# -*- coding: utf-8 -*-
"""
sources.md 의 시장지표 표를 최신 값으로 갱신합니다.

    python scripts/update_sources.py              # sources.md 갱신
    python scripts/update_sources.py --dry-run    # 파일을 고치지 않고 표만 보여줍니다
    python scripts/update_sources.py --file 경로  # 다른 파일에 넣습니다

지키는 것
  · 아래 두 표시 사이만 바꿉니다. 나머지 문장은 그대로 둡니다.
        <!-- MARKET_DATA_START -->  …  <!-- MARKET_DATA_END -->
  · 표시가 없으면 파일 끝에 **한 번만** 새로 붙입니다. (여러 번 실행해도 표가 늘지 않습니다)
  · 조회하지 못한 값은 지어내지 않고 '확인 필요' 로 둡니다.
  · 일부가 실패해도 성공한 값은 저장합니다.
  · 파일은 UTF-8 로 저장합니다.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import common as c
import market_data as md

START = "<!-- MARKET_DATA_START -->"
END = "<!-- MARKET_DATA_END -->"

DEFAULT_FILE = c.PROJECT_ROOT / "sources.md"
LOCK_FILE = c.PROJECT_ROOT / ".update-sources.lock"
LOCK_STALE_MINUTES = 10

NEW_FILE_HEADER = """# 시장지표 확인표

이 문서는 시황 글을 쓰기 전에 **오늘의 시세를 한눈에 보려고** 두는 파일입니다.
아래 표는 `python scripts/update_sources.py` 로 자동 갱신됩니다.

표 바깥에 적으신 메모는 갱신할 때 지워지지 않습니다.
"""


# ──────────────────────────────────────────────────────────────
# 같은 시각에 두 번 돌지 않도록
# ──────────────────────────────────────────────────────────────

def acquire_lock() -> bool:
    """이미 돌고 있으면 False. 10분이 지난 잠금은 버려진 것으로 봅니다."""
    if LOCK_FILE.exists():
        try:
            age_minutes = (
                c.now_kst().timestamp() - LOCK_FILE.stat().st_mtime
            ) / 60
        except OSError:
            age_minutes = 999
        if age_minutes < LOCK_STALE_MINUTES:
            return False
        c.warn(f"오래된 잠금 파일을 지웁니다 ({age_minutes:.0f}분 전).")
        release_lock()
    LOCK_FILE.write_text(
        f"pid={os.getpid()}\nstarted={c.now_kst():%Y-%m-%d %H:%M:%S KST}\n",
        encoding="utf-8",
    )
    return True


def release_lock() -> None:
    try:
        LOCK_FILE.unlink(missing_ok=True)
    except OSError:
        pass


# ──────────────────────────────────────────────────────────────
# 표 만들기
# ──────────────────────────────────────────────────────────────

def _cell_source(name: str, url: str) -> str:
    if not name or name == md.DASH:
        return md.DASH
    return f"[{name}]({url})" if url else name


def build_block(quotes: list[md.Quote]) -> str:
    """표시 사이에 들어갈 내용 전체를 만듭니다."""
    lines: list[str] = []
    lines.append(START)
    lines.append("")
    lines.append("## 시장지표 자동 확인")
    lines.append("")
    lines.append("| 항목 | 값 | 출처 1 | 출처 2 | 교차확인 | 확인일시 |")
    lines.append("| --- | ---: | --- | --- | :---: | --- |")

    for q in quotes:
        if q.verified:
            value = q.display_value()
            src1 = _cell_source(q.source1, q.source1_url)
            src2 = _cell_source(q.source2, q.source2_url)
            mark = "✓"
            when = q.checked_at
        else:
            value = md.MISSING
            src1 = "조회 실패"
            src2 = md.DASH
            mark = "✗"
            when = q.checked_at if q.checked_at != md.MISSING else c.now_kst().strftime("%Y-%m-%d %H:%M KST")
        lines.append(f"| {q.item} | {value} | {src1} | {src2} | {mark} | {when} |")

    lines.append("")
    lines.append("> 가격·지수·환율은 조회 시점에 따라 변동될 수 있습니다.  ")
    lines.append("> 조회하지 못한 값은 임의로 작성하지 않고 `확인 필요`로 표시합니다.  ")
    lines.append("> 기준 통화 — 비트코인·이더리움·시가총액은 **USD**, 환율은 **USD/KRW**입니다.")

    failed = [q for q in quotes if not q.verified]
    if failed:
        lines.append("")
        lines.append("**조회하지 못한 항목**")
        lines.append("")
        for q in failed:
            reason = md.mask_secrets(q.error or "알 수 없는 이유")
            lines.append(f"- {q.item} — {reason}")

    lines.append("")
    lines.append(END)
    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────
# 파일에 넣기
# ──────────────────────────────────────────────────────────────

def splice(original: str, block: str) -> str:
    """
    표시 사이만 갈아 끼웁니다.
    표시가 없으면 파일 끝에 한 번만 붙입니다.
    """
    i = original.find(START)
    j = original.find(END)

    if i != -1 and j != -1 and j > i:
        return original[:i] + block + original[j + len(END):]

    if i != -1 or j != -1:
        # 한쪽만 있으면 사람이 보고 고쳐야 합니다. 함부로 자르지 않습니다.
        raise ValueError(
            "시작·종료 표시 중 한쪽만 있습니다. "
            f"파일에서 '{START}' 와 '{END}' 가 짝을 이루는지 확인해 주세요."
        )

    body = original.rstrip("\n")
    joiner = "\n\n" if body else ""
    return f"{body}{joiner}{block}\n"


def update_file(path: Path, quotes: list[md.Quote], dry_run: bool = False) -> tuple[bool, str]:
    block = build_block(quotes)

    if path.exists():
        original = c.read_text(path)
    else:
        original = NEW_FILE_HEADER

    updated = splice(original, block)

    if dry_run:
        return False, updated

    if path.exists() and updated == original:
        return False, updated

    c.ensure_dir(path.parent)
    c.write_text(path, updated)
    return True, updated


# ──────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="sources.md 시장지표 표 자동 갱신")
    ap.add_argument("--file", help="갱신할 파일 (기본: 프로젝트의 sources.md)")
    ap.add_argument("--dry-run", action="store_true", help="파일을 고치지 않고 표만 보여줍니다")
    args = ap.parse_args()

    target = Path(args.file).expanduser().resolve() if args.file else DEFAULT_FILE

    if not args.dry_run and not acquire_lock():
        c.error("이미 갱신이 돌고 있습니다. 잠시 후 다시 실행해 주세요.")
        c.say(f"     잠금 파일: {c.rel(LOCK_FILE)}")
        return 1

    try:
        c.header("시장지표 자동 확인")
        c.say(f"  대상 파일: {target}")
        c.say()

        quotes = md.fetch_all(log=c.say)
        c.say()

        ok_count = sum(1 for q in quotes if q.verified)
        fail_count = len(quotes) - ok_count

        changed, text = update_file(target, quotes, dry_run=args.dry_run)

        if args.dry_run:
            c.say("── 만들어진 표 (파일은 고치지 않았습니다) " + "─" * 20)
            c.say(build_block(quotes))
        elif changed:
            c.ok(f"저장했습니다: {target}")
        else:
            c.info("값이 이전과 같아 파일을 고치지 않았습니다.")

        c.say()
        c.say(f"  조회 성공 {ok_count}개 / 확인 필요 {fail_count}개")
        if fail_count:
            c.say()
            c.warn("아래 항목은 값을 채우지 않고 '확인 필요' 로 두었습니다.")
            for q in quotes:
                if not q.verified:
                    c.say(f"     · {q.item} — {md.mask_secrets(q.error or '알 수 없는 이유')}")
            c.say()
            c.say("     숫자를 지어내지 마세요. 본문에서 빼거나 '확인 필요' 로 남겨 두세요.")
        c.say()
        return 0
    finally:
        if not args.dry_run:
            release_lock()


if __name__ == "__main__":
    sys.exit(main())
