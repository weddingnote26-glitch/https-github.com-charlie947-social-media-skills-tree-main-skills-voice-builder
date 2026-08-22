# -*- coding: utf-8 -*-
"""
오늘의 시세 적어두기 — 기준 출처에서 읽은 값을 sources.md 에 넣습니다.

시세는 사람이 화면에서 읽어야 합니다.
이 스크립트는 어디를 열어야 하는지 알려 주고,
붙여 넣을 표를 만들어 줍니다. 숫자를 스스로 채우지 않습니다.

    python scripts/quotes.py                    # 열어 볼 주소 보기
    python scripts/quotes.py --channel coin     # 코인 항목만
    python scripts/quotes.py --table            # 붙여 넣을 표만 출력
"""
from __future__ import annotations

import argparse

import common as c


def load() -> dict:
    ds = c.read_yaml(c.CONFIG_DIR / "data_sources.yaml", default={}) or {}
    if not ds.get("primary"):
        c.error("config/data_sources.yaml 에 기준 출처가 없습니다.")
        raise SystemExit(1)
    return ds


def items(ds: dict, channel: str | None) -> list[dict]:
    watch = ds.get("watchlist") or {}
    keys = [channel] if channel else list(watch.keys())
    out = []
    for k in keys:
        for it in watch.get(k) or []:
            out.append({**it, "channel": k})
    return out


def show_links(ds: dict, rows: list[dict]) -> None:
    pri = ds["primary"]
    c.header("기준 출처에서 시세 확인하기")
    c.say(f"  기준 출처: {pri['name']} — {pri['url']}")
    c.say(f"  지정일: {pri.get('designated_at', '–')} ({pri.get('designated_by', '–')})")
    c.say()

    unverified = 0
    for r in rows:
        mark = " " if r.get("verified") else "?"
        url = r.get("url") or "확인 필요"
        if not r.get("verified"):
            unverified += 1
        c.say(f"  {mark} [{r['channel']}] {c.pad(r['label'], 20)} {url}")

    c.say()
    if unverified:
        c.warn(f"주소를 확인하지 못한 항목이 {unverified}개 있습니다 (앞에 ? 표시).")
        c.say("     처음 한 번 열어 보시고, 다르면 config/data_sources.yaml 의")
        c.say("     url 을 고치고 verified 를 true 로 바꿔 주세요.")
        c.say()


def show_table(ds: dict, rows: list[dict]) -> None:
    rules = ds.get("rules") or {}
    need_q = (rules.get("quote") or {}).get("min_sources", 1)
    need_c = (rules.get("claim") or {}).get("min_sources", 2)
    pri = ds["primary"]["name"]
    today = c.now_kst().strftime("%Y-%m-%d %H:%M KST")

    c.header("sources.md 에 붙여 넣을 표")
    c.say("  값 칸만 채우시면 됩니다. 읽은 값이 없으면 그 줄은 지우세요.")
    c.say()
    c.say("| 항목 | 값 | 출처 1 | 출처 2 | 교차확인 | 확인일시 |")
    c.say("|---|---|---|---|---|---|")
    for r in rows:
        c.say(f"| {r['label']} | 확인 필요 | {pri} | – | ✗ | {today} |")
    c.say()
    c.info(f"화면에서 읽은 값(가격·지수·환율)은 {pri} 한 곳이면 됩니다. (출처 {need_q}곳)")
    c.info(f"사건·발표(승인·금리·규제)는 서로 다른 출처 {need_c}곳이 필요합니다.")
    c.say()
    c.warn("값을 채운 줄은 교차확인 칸을 ✗ 에서 ✓ 로 바꿔 주세요.")
    c.warn("확인하지 못한 값은 지어내지 말고 '확인 필요' 로 두세요.")
    c.say()


def main() -> int:
    ap = argparse.ArgumentParser(description="기준 출처에서 시세 확인하기")
    ap.add_argument("--channel", choices=["coin", "stock"], help="이 채널 항목만 봅니다")
    ap.add_argument("--table", action="store_true", help="붙여 넣을 표만 출력합니다")
    args = ap.parse_args()

    ds = load()
    rows = items(ds, args.channel)
    if not rows:
        c.error("볼 항목이 없습니다. config/data_sources.yaml 의 watchlist 를 확인하세요.")
        return 1

    if not args.table:
        show_links(ds, rows)
    show_table(ds, rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
