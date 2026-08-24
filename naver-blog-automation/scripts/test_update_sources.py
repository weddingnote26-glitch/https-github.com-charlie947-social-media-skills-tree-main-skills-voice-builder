# -*- coding: utf-8 -*-
"""
sources.md 자동 갱신 검사 — 네트워크 없이 도는 검사입니다.

    python scripts/test_update_sources.py

가장 중요하게 보는 것
  **조회에 실패했을 때 이전 값이 최신 값인 척 남아 있지 않아야 합니다.**
  그 밖에 표 위치·보존·키 가리기·값 표기도 함께 봅니다.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import market_data as md
import update_sources as us

_passed = 0
_failed: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    global _passed
    if condition:
        _passed += 1
        print(f"  ✅ {name}")
    else:
        _failed.append(name)
        print(f"  ❌ {name}")
        if detail:
            print(f"       {detail}")


def q_ok(key: str, item: str, value: str, raw: float) -> md.Quote:
    return md.Quote(
        key=key, item=item, value=value, raw_value=raw,
        source1="CoinGecko", source1_url="https://www.coingecko.com/",
        verified=True, checked_at="2026-08-24 09:15 KST",
    )


def q_fail(key: str, item: str, reason: str) -> md.Quote:
    return md.Quote(key=key, item=item, verified=False, error=reason)


def main() -> int:
    print()
    print("── sources.md 자동 갱신 검사 " + "─" * 30)
    print()

    # ── 1. 실패한 값은 '확인 필요' 로 남는다 ────────────────────
    block = us.build_block([q_fail("kosdaq", "코스닥", "HTTP 503 Service Unavailable")])
    row = [ln for ln in block.splitlines() if ln.startswith("| 코스닥")][0]
    check("실패 항목은 '확인 필요' 로 표시된다", "확인 필요" in row, row)
    check("실패 항목의 교차확인은 ✗ 다", "✗" in row, row)
    check("실패 항목의 출처는 '조회 실패' 다", "조회 실패" in row, row)

    # ── 2. ★ 실패해도 이전 값을 재사용하지 않는다 ★ ─────────────
    before = us.splice("", us.build_block([q_ok("btc", "비트코인", "$64,250.18", 64250.18)]))
    check("먼저 성공한 값이 파일에 들어간다", "$64,250.18" in before)

    after = us.splice(before, us.build_block([q_fail("btc", "비트코인", "연결 실패")]))
    check(
        "★ 조회 실패 후 이전 값이 사라진다 (재사용 안 함)",
        "$64,250.18" not in after,
        "이전 값이 남아 있으면 최신 값처럼 오해됩니다",
    )
    check("★ 그 자리에는 '확인 필요' 가 남는다", "확인 필요" in after)

    # ── 3. 일부 실패해도 성공한 값은 저장된다 ───────────────────
    mixed = us.build_block([
        q_ok("btc", "비트코인", "$64,250.18", 64250.18),
        q_fail("kosdaq", "코스닥", "조회 실패"),
        q_ok("usdkrw", "원·달러 환율", "1,382.40원", 1382.4),
    ])
    check("일부 실패해도 성공한 값은 남는다", "$64,250.18" in mixed and "1,382.40원" in mixed)
    check("같은 표에 실패 항목도 함께 남는다", "확인 필요" in mixed)
    check("실패 이유가 표 아래에 적힌다", "조회 실패" in mixed and "**조회하지 못한 항목**" in mixed)

    # ── 4. 표 바깥 문장은 보존된다 ──────────────────────────────
    doc = (
        "# 내 문서\n\n앞에 쓴 문장입니다.\n\n"
        + us.build_block([q_ok("btc", "비트코인", "$1.00", 1.0)])
        + "\n\n뒤에 쓴 문장입니다.\n"
    )
    doc2 = us.splice(doc, us.build_block([q_ok("btc", "비트코인", "$2.00", 2.0)]))
    check("표 앞 문장이 보존된다", "앞에 쓴 문장입니다." in doc2)
    check("표 뒤 문장이 보존된다", "뒤에 쓴 문장입니다." in doc2)
    check("표 안의 값은 새 값으로 바뀐다", "$2.00" in doc2 and "$1.00" not in doc2)

    # ── 5. 여러 번 실행해도 표가 늘지 않는다 ────────────────────
    text = "# 문서\n\n내용\n"
    for _ in range(3):
        text = us.splice(text, us.build_block([q_ok("btc", "비트코인", "$1.00", 1.0)]))
    check("세 번 실행해도 시작 표시는 1개", text.count(us.START) == 1, f"{text.count(us.START)}개")
    check("세 번 실행해도 종료 표시는 1개", text.count(us.END) == 1, f"{text.count(us.END)}개")
    check("세 번 실행해도 표 제목은 1개", text.count("## 시장지표 자동 확인") == 1)

    # ── 6. 표시가 한쪽만 있으면 멈춘다 ──────────────────────────
    try:
        us.splice("# 문서\n\n<!-- MARKET_DATA_START -->\n표만 있고 끝 표시가 없음\n",
                  us.build_block([q_ok("btc", "비트코인", "$1.00", 1.0)]))
        check("표시가 한쪽만 있으면 멈춘다", False, "오류 없이 지나갔습니다")
    except ValueError:
        check("표시가 한쪽만 있으면 멈춘다", True)

    # ── 7. 오류 메시지에서 키를 가린다 ──────────────────────────
    masked = md.mask_secrets("https://api.example.com/v1?api_key=abcd1234efgh5678 실패")
    check("URL 안의 api_key 가 가려진다", "abcd1234efgh5678" not in masked, masked)
    masked2 = md.mask_secrets("키 b7f3c2a19d4e5f60718293a4b5c6d7e8 로 요청함")
    check("긴 토큰 문자열이 가려진다", "b7f3c2a19d4e5f60718293a4b5c6d7e8" not in masked2, masked2)

    # ── 8. 값 표기 ─────────────────────────────────────────────
    check("달러 표기", md.fmt_usd(64250.181) == "$64,250.18", md.fmt_usd(64250.181))
    check("퍼센트 표기", md.fmt_percent(54.2345) == "54.23%", md.fmt_percent(54.2345))
    check("원화 표기", md.fmt_krw(1382.4) == "1,382.40원", md.fmt_krw(1382.4))
    check("지수 표기", md.fmt_index(3245.181) == "3,245.18", md.fmt_index(3245.181))
    check("시가총액 조 단위", md.fmt_usd_trillion(2.35e12) == "$2.35조", md.fmt_usd_trillion(2.35e12))

    # ── 9. 휴장 꼬리표 ─────────────────────────────────────────
    stale = md.Quote(key="sp500", item="S&P 500", value="3,245.18",
                     note="(마지막 거래 값)", verified=True)
    check("휴장 시 마지막 거래 값 꼬리표가 붙는다",
          stale.display_value() == "3,245.18 (마지막 거래 값)", stale.display_value())

    # ── 10. 실패 항목은 값이 있어도 '확인 필요' 로 나간다 ────────
    poisoned = md.Quote(key="x", item="시험", value="$999.99", raw_value=999.99, verified=False)
    check("★ verified 가 아니면 값이 있어도 '확인 필요' 로 나간다",
          poisoned.display_value() == "확인 필요", poisoned.display_value())

    # ── 11. 파일에 실제로 쓰고 다시 읽어도 한글이 안 깨진다 ──────
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "sources.md"
        us.update_file(p, [q_ok("usdkrw", "원·달러 환율", "1,382.40원", 1382.4)])
        got = p.read_text(encoding="utf-8")
        check("UTF-8 로 저장되고 한글이 그대로다",
              "원·달러 환율" in got and "1,382.40원" in got)
        check("새 파일에도 표시가 한 번만 들어간다", got.count(us.START) == 1)

    print()
    print("─" * 58)
    if _failed:
        print(f"  통과 {_passed}개 / 실패 {len(_failed)}개")
        for name in _failed:
            print(f"    ❌ {name}")
        return 1
    print(f"  ✅ {_passed}개 전부 통과")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
