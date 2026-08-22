# -*- coding: utf-8 -*-
"""
중복 발행 방지와 예약 충돌 검사.

  자동화가 중간에 멈췄다가 다시 실행되면 같은 글이 두 번 올라갈 수 있습니다.
  또 같은 채널·같은 시각에 두 글을 예약하면 하나가 묻힙니다.
  예약을 걸기 전에 여기서 먼저 걸러 냅니다.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

from scripts import common as c
from scripts import textutil as t
from scripts.postfile import PostFile

WEEKDAY_ALLOWED = {0, 1, 2, 3, 4, 5}      # 월~토
SIMILAR_LIMIT = 0.60                       # 이 이상 닮으면 같은 글로 의심


def _all_posts(exclude: Path | None = None) -> list[dict]:
    """
    만들어 둔 모든 주차의 게시물을 모읍니다.
    exclude 는 자기 자신을 빼기 위한 것입니다.
    상대경로로 들어와도 맞게 비교되도록 절대경로로 맞춰 둡니다.
    """
    out = []
    if not c.OUTPUT_DIR.exists():
        return out
    skip = exclude.resolve() if exclude else None
    for meta_path in c.OUTPUT_DIR.rglob("metadata.yaml"):
        pdir = meta_path.parent
        if skip and pdir.resolve() == skip:
            continue
        meta = c.read_yaml(meta_path, default={}) or {}
        if not meta.get("post_id"):
            continue
        out.append({"dir": pdir, "meta": meta})
    return out


# ──────────────────────────────────────────────────────────────
def check_duplicate(pdir: Path) -> list[str]:
    """이 글이 이미 올라간 글과 겹치지 않는지 봅니다."""
    problems: list[str] = []
    meta = c.read_yaml(pdir / "metadata.yaml", default={}) or {}
    pid = meta.get("post_id")
    chash = meta.get("content_hash")
    title = (meta.get("title") or "").strip()
    ch_key = pdir.parent.name
    date = (meta.get("publish") or {}).get("date")

    post_path = pdir / "post.md"
    body = PostFile.load(post_path).prose() if post_path.exists() else ""

    # 이미 네이버에 올라간 기록이 있으면 다시 올리면 안 됩니다.
    logno = (meta.get("published") or {}).get("naver_log_no") or meta.get("naver_log_no")
    url = (meta.get("published") or {}).get("post_url")
    if logno or url:
        problems.append(
            f"이 글은 이미 네이버에 올라간 기록이 있습니다 "
            f"({url or ('게시물번호 ' + str(logno))}). 다시 올리면 중복이 됩니다."
        )

    for other in _all_posts(exclude=pdir):
        om, od = other["meta"], other["dir"]
        opid = om.get("post_id")

        if opid == pid:
            problems.append(f"같은 게시물 ID가 다른 폴더에도 있습니다: {c.rel(od)}")
            continue

        same_channel = od.parent.name == ch_key
        otitle = (om.get("title") or "").strip()

        if title and otitle == title and same_channel:
            problems.append(f"같은 제목의 글이 이미 있습니다: {opid} ({c.rel(od)})")

        if chash and om.get("content_hash") == chash:
            problems.append(f"본문이 완전히 같은 글이 있습니다: {opid}")
            continue

        if same_channel and (om.get("publish") or {}).get("date") == date:
            problems.append(f"같은 채널·같은 날짜에 다른 글이 있습니다: {opid}")

        # 본문이 매우 비슷하면 알려 줍니다. (해시가 달라도)
        opost = od / "post.md"
        if body and opost.exists():
            sim = t.similarity(body, PostFile.load(opost).prose())
            if sim >= SIMILAR_LIMIT:
                problems.append(
                    f"{opid} 와(과) 본문이 {sim:.0%} 닮았습니다. "
                    f"같은 글을 다시 올리는 것은 아닌지 확인해 주세요."
                )
    return problems


# ──────────────────────────────────────────────────────────────
def check_schedule(pdir: Path, settings: dict, now: dt.datetime | None = None) -> list[str]:
    """예약 시각에 문제가 없는지 봅니다."""
    problems: list[str] = []
    now = now or c.now_kst()
    meta = c.read_yaml(pdir / "metadata.yaml", default={}) or {}
    pub = meta.get("publish") or {}
    pid = meta.get("post_id")
    ch_key = pdir.parent.name
    ch = c.get_channel(ch_key)

    date_s, time_s = str(pub.get("date") or ""), str(pub.get("time") or "")

    try:
        d = dt.date.fromisoformat(date_s)
    except ValueError:
        return [f"예약 날짜를 읽을 수 없습니다: 「{date_s}」"]

    try:
        hh, mm = (int(x) for x in time_s.split(":"))
        when = dt.datetime.combine(d, dt.time(hh, mm), tzinfo=c.KST)
    except (ValueError, TypeError):
        return [f"예약 시각을 읽을 수 없습니다: 「{time_s}」 (예: 07:30)"]

    # 1. 이미 지난 시각
    if when <= now:
        problems.append(
            f"예약 시각이 이미 지났습니다. "
            f"({date_s} {time_s} / 지금은 {now:%Y-%m-%d %H:%M})"
        )

    # 2. 발행 요일
    if d.weekday() not in WEEKDAY_ALLOWED:
        problems.append(f"{date_s} 은 {c.weekday_ko(d)}요일입니다. 월~토에만 발행합니다.")

    # 3. 폴더 날짜와 일치
    if pdir.name != date_s:
        problems.append(f"폴더 날짜({pdir.name})와 예약 날짜({date_s})가 다릅니다.")

    # 4. 원고에 적힌 요일과 일치
    post_path = pdir / "post.md"
    if post_path.exists():
        stated = str(PostFile.load(post_path).get("weekday") or "")
        if stated and stated != c.weekday_ko(d):
            problems.append(
                f"원고에 {stated}요일로 적혀 있는데 {date_s} 은 "
                f"{c.weekday_ko(d)}요일입니다."
            )

    # 5. 공휴일 설정
    h = settings.get("holidays") or {}
    if not h.get("publish_on_holiday", True) and date_s in (h.get("dates") or []):
        problems.append(f"{date_s} 은 발행하지 않기로 한 날입니다.")

    # 6. 같은 채널·같은 시각에 다른 예약이 있는지
    for other in _all_posts(exclude=pdir):
        om, od = other["meta"], other["dir"]
        if od.parent.name != ch_key:
            continue
        opub = om.get("publish") or {}
        if str(opub.get("date")) == date_s and str(opub.get("time")) == time_s:
            problems.append(
                f"같은 채널·같은 시각에 다른 글이 예약되어 있습니다: {om.get('post_id')}"
            )

    # 7. 채널별 최소 발행 간격
    gap_h = int((settings.get("schedule") or {}).get("min_gap_hours", 12))
    for other in _all_posts(exclude=pdir):
        om, od = other["meta"], other["dir"]
        if od.parent.name != ch_key:
            continue
        if not c.at_least(om.get("status", "draft"), "approved"):
            continue
        opub = om.get("publish") or {}
        try:
            od_date = dt.date.fromisoformat(str(opub.get("date")))
            oh, omn = (int(x) for x in str(opub.get("time")).split(":"))
            owhen = dt.datetime.combine(od_date, dt.time(oh, omn), tzinfo=c.KST)
        except (ValueError, TypeError):
            continue
        diff = abs((when - owhen).total_seconds()) / 3600
        if 0 < diff < gap_h:
            problems.append(
                f"{om.get('post_id')} 와(과) {diff:.0f}시간 차이입니다. "
                f"같은 채널은 {gap_h}시간 이상 띄우기로 되어 있습니다."
            )

    return problems


# ──────────────────────────────────────────────────────────────
def check_all(pdir: Path, settings: dict) -> dict:
    return {
        "duplicate": check_duplicate(pdir),
        "schedule": check_schedule(pdir, settings),
    }
