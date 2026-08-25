# -*- coding: utf-8 -*-
"""
시장지표 자동 조회 — 8개 항목을 공개 API 에서 읽어 옵니다.

지키는 원칙
  · 조회에 실패한 값은 **지어내지 않습니다.** '확인 필요' 로 남깁니다.
  · 예전에 받아 둔 값을 최신 값인 척 다시 쓰지 않습니다. (캐시를 두지 않습니다)
  · 기준 통화와 단위를 값에 함께 적습니다.  예: $64,250.18 / 1,382.40원
  · 모든 시각은 한국시간(KST)입니다.
  · 로그인·캡차를 건드리지 않고, 공개 API 만 씁니다.

쓰는 곳
    from market_data import fetch_all
    quotes = fetch_all()          # list[Quote]

항목별 출처는 config/data_sources.yaml 의 watchlist 순서를 따릅니다.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

import common as c

# ──────────────────────────────────────────────────────────────
# 1. 조회 결과 한 줄
# ──────────────────────────────────────────────────────────────

MISSING = "확인 필요"
DASH = "–"


@dataclass
class Quote:
    """표 한 줄에 들어갈 값. 실패해도 줄은 남고 값만 '확인 필요' 가 됩니다."""

    key: str
    item: str
    value: str = MISSING
    raw_value: float | None = None
    source1: str = DASH
    source1_url: str = ""
    source2: str = DASH
    source2_url: str = ""
    verified: bool = False
    checked_at: str = MISSING
    error: str | None = None
    # '(마지막 거래 값)' 처럼 값 뒤에 붙는 꼬리표
    note: str = ""
    # 출처가 알려 준 기준 시각 (없으면 조회 완료 시각을 씁니다)
    asof: str = ""

    def display_value(self) -> str:
        if not self.verified:
            return MISSING
        return f"{self.value} {self.note}".strip()

    def as_dict(self) -> dict:
        return {
            "item": self.item,
            "value": self.display_value(),
            "rawValue": self.raw_value,
            "source1": self.source1,
            "source1Url": self.source1_url,
            "source2": self.source2,
            "source2Url": self.source2_url,
            "verified": self.verified,
            "checkedAt": self.checked_at,
            "error": self.error,
        }


# ──────────────────────────────────────────────────────────────
# 2. 네트워크 — 재시도 2회, 시간 제한, 키 가리기
# ──────────────────────────────────────────────────────────────

UA = "Mozilla/5.0 (compatible; naver-blog-automation/1.0; +sources.md updater)"
TIMEOUT_SECONDS = 10
MAX_RETRIES = 2
# 같은 곳에 연달아 요청하지 않도록 요청 사이에 쉬는 시간
POLITE_GAP_SECONDS = 0.7

_SECRET_PATTERNS = [
    re.compile(r"((?:api[_-]?key|apikey|token|access[_-]?key|secret)=)[^&\s]+", re.I),
    re.compile(r"\b[A-Za-z0-9]{32,}\b"),
]


def mask_secrets(text: str) -> str:
    """오류 메시지를 화면에 찍기 전에 키처럼 보이는 값을 가립니다."""
    out = str(text)
    out = _SECRET_PATTERNS[0].sub(r"\1***", out)
    out = _SECRET_PATTERNS[1].sub("***", out)
    return out


# 429(요청 과다)를 만났을 때 기다리는 시간. 무료 API 는 보통 1분 단위로 셉니다.
RATE_LIMIT_WAIT_SECONDS = 20


def _get_json(url: str, headers: dict | None = None) -> dict:
    """JSON 을 받아 옵니다. 실패하면 마지막 오류를 그대로 올립니다."""
    last: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})},
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - 어떤 실패든 재시도 대상입니다
            last = exc
            if attempt >= MAX_RETRIES:
                break
            # 요청이 너무 잦다는 응답이면 조금 더 오래 쉽니다.
            if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                wait = RATE_LIMIT_WAIT_SECONDS
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                if retry_after and str(retry_after).strip().isdigit():
                    wait = min(int(retry_after), 60)
                time.sleep(wait)
            else:
                time.sleep(1.5 * (attempt + 1))
    raise last if last else RuntimeError("알 수 없는 오류")


def _describe(exc: Exception) -> str:
    """사용자가 읽을 수 있는 짧은 실패 사유."""
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code == 429:
            return "요청이 너무 잦아 잠시 막혔습니다 (몇 분 뒤 다시 실행해 주세요)"
        return mask_secrets(f"HTTP {exc.code} {exc.reason}")
    if isinstance(exc, urllib.error.URLError):
        return mask_secrets(f"연결 실패: {exc.reason}")
    if isinstance(exc, TimeoutError):
        return f"{TIMEOUT_SECONDS}초 안에 응답 없음"
    return mask_secrets(f"{type(exc).__name__}: {exc}")


# ──────────────────────────────────────────────────────────────
# 3. .env — 선택 사항입니다. 없어도 8개 항목 모두 조회됩니다.
# ──────────────────────────────────────────────────────────────

def load_env() -> dict:
    """
    프로젝트 폴더의 .env 를 읽습니다. (없으면 빈 값)

    지금 쓰는 기본 출처는 모두 키가 필요 없습니다.
    키는 기본 출처가 막혔을 때 쓰는 대체 경로에만 씁니다.
    """
    env: dict[str, str] = {}
    path = c.PROJECT_ROOT / ".env"
    if path.exists():
        for line in c.read_text(path).splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    # 환경변수가 있으면 그쪽이 우선입니다.
    for k in ("COINMARKETCAP_API_KEY",):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


# ──────────────────────────────────────────────────────────────
# 4. 값 표기 — 소수점·천 단위를 항목마다 일정하게
# ──────────────────────────────────────────────────────────────

def fmt_usd(v: float) -> str:
    return "$" + f"{v:,.2f}"


def fmt_percent(v: float) -> str:
    return f"{v:.2f}%"


def fmt_krw(v: float) -> str:
    return f"{v:,.2f}원"


def fmt_index(v: float) -> str:
    return f"{v:,.2f}"


def fmt_usd_trillion(v: float) -> str:
    """가상자산 시가총액처럼 큰 값은 조(兆) 단위로 줄여 적습니다."""
    return f"${v / 1e12:,.2f}조"


def _kst_stamp(ts: _dt.datetime | None = None) -> str:
    return (ts or c.now_kst()).strftime("%Y-%m-%d %H:%M KST")


def _from_epoch(epoch: float) -> _dt.datetime:
    return _dt.datetime.fromtimestamp(epoch, tz=c.KST)


def _stale_note(market_time: _dt.datetime) -> str:
    """장이 닫혀 오늘 값이 아니면 꼬리표를 붙입니다."""
    if market_time.date() != c.now_kst().date():
        return "(마지막 거래 값)"
    return ""


# ──────────────────────────────────────────────────────────────
# 5. 출처별 조회
# ──────────────────────────────────────────────────────────────

COINGECKO = "CoinGecko"
COINGECKO_URL = "https://www.coingecko.com/"
YAHOO = "Yahoo Finance"
FRANKFURTER = "Frankfurter (유럽중앙은행 고시)"
FRANKFURTER_URL = "https://www.frankfurter.app/"


def _coingecko_prices() -> dict:
    url = (
        "https://api.coingecko.com/api/v3/simple/price"
        "?ids=bitcoin,ethereum&vs_currencies=usd&include_last_updated_at=true"
    )
    return _get_json(url)


def _coingecko_global() -> dict:
    return _get_json("https://api.coingecko.com/api/v3/global")


def _yahoo_chart(symbol: str) -> dict:
    """
    야후 파이낸스의 공개 차트 응답에서 마지막 체결값과 그 시각을 읽습니다.
    화면을 긁는 것이 아니라 JSON 응답만 씁니다.
    """
    from urllib.parse import quote

    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
        "?interval=1d&range=5d"
    )
    data = _get_json(url)
    result = ((data.get("chart") or {}).get("result") or [None])[0]
    if not result:
        raise ValueError("응답에 시세가 없습니다")
    meta = result.get("meta") or {}
    price = meta.get("regularMarketPrice")
    if price is None:
        raise ValueError("응답에 종가가 없습니다")
    return {
        "price": float(price),
        "time": _from_epoch(meta["regularMarketTime"]) if meta.get("regularMarketTime") else None,
        "currency": meta.get("currency") or "",
    }


def _frankfurter_usdkrw() -> dict:
    data = _get_json("https://api.frankfurter.app/latest?from=USD&to=KRW")
    rate = (data.get("rates") or {}).get("KRW")
    if rate is None:
        raise ValueError("응답에 KRW 환율이 없습니다")
    return {"rate": float(rate), "date": data.get("date") or ""}


def _coinmarketcap(env: dict) -> dict | None:
    """CoinGecko 가 막혔을 때만 쓰는 대체 경로. 키가 없으면 건너뜁니다."""
    key = env.get("COINMARKETCAP_API_KEY")
    if not key:
        return None
    url = (
        "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest"
        "?symbol=BTC,ETH&convert=USD"
    )
    return _get_json(url, headers={"X-CMC_PRO_API_KEY": key})


# ──────────────────────────────────────────────────────────────
# 6. 항목 정의 — config/data_sources.yaml 의 watchlist 와 같은 순서
# ──────────────────────────────────────────────────────────────

ITEMS: list[tuple[str, str]] = [
    ("btc", "비트코인"),
    ("eth", "이더리움"),
    ("btc_dominance", "비트코인 도미넌스"),
    ("total_mcap", "가상자산 시가총액 합계"),
    ("kospi", "코스피"),
    ("kosdaq", "코스닥"),
    ("usdkrw", "원·달러 환율"),
    ("sp500", "S&P 500"),
]

YAHOO_SYMBOLS = {
    "kospi": ("^KS11", "https://finance.yahoo.com/quote/%5EKS11/"),
    "kosdaq": ("^KQ11", "https://finance.yahoo.com/quote/%5EKQ11/"),
    "sp500": ("^GSPC", "https://finance.yahoo.com/quote/%5EGSPC/"),
    "usdkrw": ("KRW=X", "https://finance.yahoo.com/quote/KRW=X/"),
}

COIN_PAGES = {
    "btc": "https://www.coingecko.com/en/coins/bitcoin",
    "eth": "https://www.coingecko.com/en/coins/ethereum",
    "btc_dominance": "https://www.coingecko.com/en/global-charts",
    "total_mcap": "https://www.coingecko.com/en/global-charts",
}


# ──────────────────────────────────────────────────────────────
# 7. 전체 조회
# ──────────────────────────────────────────────────────────────

def _tolerance_percent() -> float:
    """두 출처 값이 이 비율(%)보다 더 벌어지면 자동 확정하지 않습니다."""
    settings = c.load_settings() or {}
    fc = settings.get("factcheck") or {}
    try:
        return float(fc.get("tolerance_percent", 1.0))
    except (TypeError, ValueError):
        return 1.0


def fetch_all(log=None) -> list[Quote]:
    """8개 항목을 조회합니다. 하나가 실패해도 나머지는 계속 진행합니다."""
    say = log or (lambda *_: None)
    env = load_env()
    quotes = {k: Quote(key=k, item=label) for k, label in ITEMS}

    # ── 코인 4항목 ────────────────────────────────────────────
    try:
        prices = _coingecko_prices()
        stamp = _kst_stamp()
        for key, cg_id in (("btc", "bitcoin"), ("eth", "ethereum")):
            node = prices.get(cg_id) or {}
            usd = node.get("usd")
            if usd is None:
                raise ValueError(f"{cg_id} 값 없음")
            q = quotes[key]
            q.raw_value = float(usd)
            q.value = fmt_usd(q.raw_value)
            q.source1, q.source1_url = COINGECKO, COIN_PAGES[key]
            q.verified = True
            q.asof = _kst_stamp(_from_epoch(node["last_updated_at"])) if node.get("last_updated_at") else stamp
            q.checked_at = q.asof
        say(f"  · 비트코인·이더리움 — {COINGECKO} 조회 성공")
    except Exception as exc:  # noqa: BLE001
        reason = _describe(exc)
        for key in ("btc", "eth"):
            quotes[key].error = reason
        say(f"  · 비트코인·이더리움 — 실패: {reason}")

        cmc = None
        try:
            cmc = _coinmarketcap(env)
        except Exception as exc2:  # noqa: BLE001
            say(f"  · 대체 출처(CoinMarketCap)도 실패: {_describe(exc2)}")
        if cmc:
            stamp = _kst_stamp()
            for key, sym in (("btc", "BTC"), ("eth", "ETH")):
                try:
                    usd = cmc["data"][sym]["quote"]["USD"]["price"]
                    q = quotes[key]
                    q.raw_value = float(usd)
                    q.value = fmt_usd(q.raw_value)
                    q.source1 = "CoinMarketCap"
                    q.source1_url = f"https://coinmarketcap.com/currencies/{'bitcoin' if key == 'btc' else 'ethereum'}/"
                    q.verified = True
                    q.checked_at = q.asof = stamp
                    q.error = None
                except Exception:  # noqa: BLE001
                    pass
            say("  · 대체 출처(CoinMarketCap)로 채웠습니다")

    time.sleep(POLITE_GAP_SECONDS)

    try:
        g = (_coingecko_global() or {}).get("data") or {}
        dom = (g.get("market_cap_percentage") or {}).get("btc")
        mcap = (g.get("total_market_cap") or {}).get("usd")
        stamp = _kst_stamp(_from_epoch(g["updated_at"])) if g.get("updated_at") else _kst_stamp()

        if dom is None:
            raise ValueError("도미넌스 값 없음")
        q = quotes["btc_dominance"]
        q.raw_value = float(dom)
        q.value = fmt_percent(q.raw_value)
        q.source1, q.source1_url = COINGECKO, COIN_PAGES["btc_dominance"]
        q.verified = True
        q.checked_at = q.asof = stamp

        if mcap is None:
            raise ValueError("시가총액 값 없음")
        q = quotes["total_mcap"]
        q.raw_value = float(mcap)
        q.value = fmt_usd_trillion(q.raw_value)
        q.source1, q.source1_url = COINGECKO, COIN_PAGES["total_mcap"]
        q.verified = True
        q.checked_at = q.asof = stamp
        say(f"  · 도미넌스·시가총액 — {COINGECKO} 조회 성공")
    except Exception as exc:  # noqa: BLE001
        reason = _describe(exc)
        for key in ("btc_dominance", "total_mcap"):
            if not quotes[key].verified:
                quotes[key].error = reason
        say(f"  · 도미넌스·시가총액 — 실패: {reason}")

    # ── 지수 3항목 (코스피·코스닥·S&P 500) ───────────────────
    for key in ("kospi", "kosdaq", "sp500"):
        time.sleep(POLITE_GAP_SECONDS)
        symbol, page = YAHOO_SYMBOLS[key]
        q = quotes[key]
        try:
            got = _yahoo_chart(symbol)
            q.raw_value = got["price"]
            q.value = fmt_index(q.raw_value)
            q.note = _stale_note(got["time"]) if got["time"] else ""
            q.source1, q.source1_url = YAHOO, page
            q.verified = True
            q.checked_at = q.asof = _kst_stamp(got["time"]) if got["time"] else _kst_stamp()
            say(f"  · {q.item} — {YAHOO} 조회 성공 {q.note}".rstrip())
        except Exception as exc:  # noqa: BLE001
            q.error = _describe(exc)
            say(f"  · {q.item} — 실패: {q.error}")

    # ── 원·달러 환율 (두 곳을 비교합니다) ─────────────────────
    time.sleep(POLITE_GAP_SECONDS)
    q = quotes["usdkrw"]
    symbol, page = YAHOO_SYMBOLS["usdkrw"]
    yahoo_rate = frank_rate = None
    y_time = None
    try:
        got = _yahoo_chart(symbol)
        yahoo_rate, y_time = got["price"], got["time"]
    except Exception as exc:  # noqa: BLE001
        q.error = _describe(exc)
    try:
        fr = _frankfurter_usdkrw()
        frank_rate = fr["rate"]
    except Exception as exc:  # noqa: BLE001
        if not q.error:
            q.error = _describe(exc)

    if yahoo_rate is not None and frank_rate is not None:
        gap = abs(yahoo_rate - frank_rate) / yahoo_rate * 100
        tol = _tolerance_percent()
        if gap > tol:
            # 두 곳 값이 크게 다르면 자동으로 정하지 않습니다.
            q.error = f"두 출처 값 차이 {gap:.2f}% (허용 {tol:.2f}%)"
            q.source1, q.source1_url = YAHOO, page
            q.source2, q.source2_url = FRANKFURTER, FRANKFURTER_URL
            q.verified = False
            say(f"  · {q.item} — 값 차이가 커서 확정하지 않았습니다 ({gap:.2f}%)")
        else:
            q.raw_value = yahoo_rate
            q.value = fmt_krw(yahoo_rate)
            q.note = _stale_note(y_time) if y_time else ""
            q.source1, q.source1_url = YAHOO, page
            q.source2, q.source2_url = FRANKFURTER, FRANKFURTER_URL
            q.verified = True
            q.checked_at = q.asof = _kst_stamp(y_time) if y_time else _kst_stamp()
            q.error = None
            say(f"  · {q.item} — 두 출처 일치 (차이 {gap:.2f}%)")
    elif yahoo_rate is not None:
        q.raw_value = yahoo_rate
        q.value = fmt_krw(yahoo_rate)
        q.note = _stale_note(y_time) if y_time else ""
        q.source1, q.source1_url = YAHOO, page
        q.verified = True
        q.checked_at = q.asof = _kst_stamp(y_time) if y_time else _kst_stamp()
        q.error = None
        say(f"  · {q.item} — {YAHOO} 조회 성공")
    elif frank_rate is not None:
        q.raw_value = frank_rate
        q.value = fmt_krw(frank_rate)
        q.source1, q.source1_url = FRANKFURTER, FRANKFURTER_URL
        q.verified = True
        q.checked_at = q.asof = _kst_stamp()
        q.error = None
        say(f"  · {q.item} — {FRANKFURTER} 조회 성공")
    else:
        say(f"  · {q.item} — 실패: {q.error}")

    return [quotes[k] for k, _ in ITEMS]


if __name__ == "__main__":
    for row in fetch_all(log=c.say):
        c.say(f"    {c.pad(row.item, 24)} {row.display_value()}")
