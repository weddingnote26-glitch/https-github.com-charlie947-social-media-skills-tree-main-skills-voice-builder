# -*- coding: utf-8 -*-
"""
주간 편성 — 월~토 두 채널에 12편의 자리를 만듭니다.

하는 일
  1. 다음 주(또는 지정한 주)의 월~토 날짜를 계산합니다.
  2. 요일별 슬롯에 맞춰 주제를 고릅니다. (이미 쓴 주제는 다시 뽑지 않음)
  3. 날짜별 폴더와 metadata.yaml, brief.md 를 만듭니다.
  4. 그 주의 일정표 schedule.csv 를 만듭니다.

실행:  python scripts/schedule_week.py [--week 2026-W36] [--force]
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c  # noqa: E402

USED_TOPICS_PATH = c.DATA_DIR / "used_topics.json"
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"]


# ──────────────────────────────────────────────────────────────
def load_used_topics() -> dict:
    return c.read_json(USED_TOPICS_PATH, default={}) or {}


def save_used_topics(data: dict) -> None:
    c.write_json(USED_TOPICS_PATH, data)


def pick_topic(bank: dict, channel: str, slot: str, used: dict,
               rng: random.Random) -> tuple[str, bool]:
    """
    주제 은행에서 아직 안 쓴 주제를 하나 고릅니다.
    반환: (주제, 은행에서 뽑았는지 여부)
    """
    pool = (bank.get(channel) or {}).get(slot) or []
    if not pool:
        # 시황·뉴스 슬롯은 은행을 쓰지 않습니다. 그 주 실제 상황에서 뽑습니다.
        return "", False

    used_list = used.setdefault(channel, {}).setdefault(slot, [])
    remaining = [t for t in pool if t not in used_list]

    if not remaining:
        # 한 바퀴 다 돌았으면 기록을 비우고 처음부터 다시 (가장 오래된 것부터)
        used_list.clear()
        remaining = list(pool)

    topic = rng.choice(remaining)
    used_list.append(topic)
    return topic, True


def is_holiday(date: dt.date, settings: dict) -> bool:
    h = settings.get("holidays") or {}
    if h.get("publish_on_holiday", True):
        return False
    return date.isoformat() in (h.get("dates") or [])


def fill(template: str, mapping: dict) -> str:
    out = template
    for k, v in mapping.items():
        out = out.replace("{{" + k + "}}", str(v))
    return out


def bullet(items) -> str:
    if not items:
        return "  - (없음)"
    return "\n".join(f"  - {i}" for i in items)


# ──────────────────────────────────────────────────────────────
def build_week(week_id_str: str | None, force: bool) -> Path:
    settings = c.load_settings()
    profiles = c.load_channels()
    channels = profiles["channels"]
    weekly_plan = profiles["weekly_plan"]
    bank = c.read_yaml(c.CONFIG_DIR / "topic_bank.yaml", default={}) or {}

    # 어느 주를 만들 것인가
    if week_id_str:
        try:
            year, wk = week_id_str.upper().split("-W")
            monday = dt.date.fromisocalendar(int(year), int(wk), 1)
        except (ValueError, TypeError):
            raise SystemExit(f"주차 형식이 잘못됐습니다: {week_id_str} (예: 2026-W36)")
    else:
        monday = c.next_week_monday()

    wid = c.week_id(monday)
    wdir = c.week_dir(wid)

    if wdir.exists() and not force:
        raise SystemExit(
            f"{wid} 주차 폴더가 이미 있습니다: {c.rel(wdir)}\n"
            f"  다시 만들려면 --force 를 붙여 주세요. (기존 원고를 덮어쓰지는 않습니다)"
        )

    c.header(f"{wid} 주간 편성 ({monday} ~ {monday + dt.timedelta(days=5)})")

    used = load_used_topics()
    # 같은 주차를 다시 만들 때 결과가 흔들리지 않도록 주차값으로 씨앗을 고정합니다.
    rng = random.Random(wid)

    brief_tpl = c.read_text(c.TEMPLATE_DIR / "brief_template.md")
    meta_tpl = c.read_text(c.TEMPLATE_DIR / "metadata_template.yaml")

    # 1단계: 주제를 먼저 모두 정합니다. (상대 채널 주제를 지시서에 넣기 위해)
    plan: list[dict] = []
    for ch_key, ch in channels.items():
        for day in DAYS:
            date = monday + dt.timedelta(days=DAYS.index(day))
            if is_holiday(date, settings):
                c.info(f"{date} ({c.WEEKDAY_KO[day]}) 공휴일 설정으로 건너뜁니다.")
                continue
            slot_cfg = weekly_plan[ch_key][day]
            slot = slot_cfg["slot"]
            topic, from_bank = pick_topic(bank, ch_key, slot, used, rng)
            plan.append({
                "channel": ch_key,
                "day": day,
                "date": date,
                "slot": slot,
                "title_hint": slot_cfg["title_hint"],
                "needs_live_data": bool(slot_cfg.get("needs_live_data")),
                # 미리 쓸 글인지, 당일에 쓸 글인지
                "advance_write": bool(slot_cfg.get("advance_write", True)),
                "topic": topic or f"(이번 주 실제 상황에서 정함 — {slot_cfg['title_hint']})",
                "from_bank": from_bank,
            })

    save_used_topics(used)

    # 2단계: 폴더와 파일을 만듭니다.
    created, skipped = 0, 0
    rows = []

    for item in plan:
        ch_key = item["channel"]
        ch = channels[ch_key]
        date = item["date"]
        pdir = c.post_dir(wid, ch_key, date)
        pid = c.post_id(ch_key, date, item["slot"])

        ptime = (settings.get("publish_times") or {}).get(
            ch_key, ch["publish"]["time"]
        )

        # 이미 원고가 있으면 건드리지 않습니다.
        if (pdir / "post.md").exists():
            c.info(f"{pid} — 원고가 이미 있어 건너뜁니다.")
            skipped += 1
        else:
            c.ensure_dir(pdir / "images")

            style = c.style_status(ch_key)
            analyzed = style.get("status") == "analyzed"
            style_warning = (
                "" if analyzed else
                "> ⚠ **이 채널의 글 양식이 아직 분석되지 않았습니다.**\n"
                "> 실제 블로그 글을 확인하지 못한 상태입니다.\n"
                "> 임시 골격으로 쓰되, 기존 글의 양식을 지어내지 마세요.\n"
                "> 샘플을 받으면 이 원고를 다시 다듬어야 합니다."
            )

            other_key = "stock" if ch_key == "coin" else "coin"
            other_topics = [
                p["topic"] for p in plan
                if p["channel"] == other_key and p["date"] == date
            ]
            recent = (used.get(ch_key, {}).get(item["slot"], []))[-6:]

            fc_note = (
                "**이 글은 발행 당일에 씁니다.** 그날의 최신 자료로 쓰세요.\n"
                "미리 써 두면 발행 시점에 이미 지난 내용이 됩니다."
                if not item["advance_write"] else
                "**이 글은 실시간 자료가 필요합니다.** 아래 규칙을 반드시 지키세요."
                if item["needs_live_data"] else
                "이 글은 실시간 시세가 없어도 됩니다. 다만 예시로 숫자를 들 때는 "
                "출처를 밝히거나 '예를 들어' 로 가정임을 분명히 하세요."
            )

            brief = fill(brief_tpl, {
                "post_id": pid,
                "channel_name": ch["name"],
                "channel_url": ch["url"],
                "blog_id": ch["blog_id"],
                "publish_date": date.isoformat(),
                "weekday_ko": c.weekday_ko(date),
                "publish_time": ptime,
                "slot": item["slot"],
                "title_hint": item["title_hint"],
                "topic": item["topic"],
                "audience_summary": ch["audience"]["summary"],
                "pain_points": bullet(ch["audience"].get("pain_points")),
                "tone_rules": bullet(ch["tone"].get("rules")),
                "tone_forbidden": bullet(ch["tone"].get("forbidden")),
                "tone_required": bullet(ch["tone"].get("required")),
                "style_status": {
                    "analyzed": "분석 완료",
                    "awaiting_samples": "샘플 대기중 (미분석)",
                }.get(style.get("status"), style.get("status", "알 수 없음")),
                "style_file": ch.get("style_file", ""),
                "style_warning": style_warning,
                "hashtag_min": ch["hashtags"]["min"],
                "hashtag_max": ch["hashtags"]["max"],
                "disclaimer": ch["disclaimer"].strip(),
                "factcheck_note": fc_note,
                "other_channel_topics": ", ".join(other_topics) or "(없음)",
                "recent_topics": ", ".join(recent) or "(없음)",
                "dir": c.rel(pdir),
            })
            c.write_text(pdir / "brief.md", brief)

            meta = fill(meta_tpl, {
                "post_id": pid,
                "channel_key": ch_key,
                "channel_name": ch["name"],
                "blog_id": ch["blog_id"],
                "channel_url": ch["url"],
                "confirm_phrase": ch["confirm_phrase"],
                "final_title": "",
                "publish_date": date.isoformat(),
                "publish_time": ptime,
                "weekday_ko": c.weekday_ko(date),
                "category": item["slot"],
                "slot": item["slot"],
            })
            # 당일에 쓸 글인지 기록합니다.
            import yaml as _y
            m = _y.safe_load(meta) or {}
            m["write_mode"] = "advance" if item["advance_write"] else "same_day"
            m["needs_live_data"] = item["needs_live_data"]
            c.write_yaml(pdir / "metadata.yaml", m)
            created += 1

        rows.append({
            "게시물ID": pid,
            "채널": ch["name"],
            "블로그ID": ch["blog_id"],
            "발행일": date.isoformat(),
            "요일": c.weekday_ko(date),
            "예약시간": ptime,
            "슬롯": item["slot"],
            "주제": item["topic"],
            "실시간자료필요": "예" if item["needs_live_data"] else "아니오",
            "작성시점": "미리" if item["advance_write"] else "당일",
            "상태": "draft",
            "폴더": c.rel(pdir),
        })

    # 3단계: 일정표
    rows.sort(key=lambda r: (r["발행일"], r["예약시간"]))
    csv_path = wdir / "schedule.csv"
    c.ensure_dir(wdir)
    # utf-8-sig : 엑셀에서 한글이 깨지지 않게 하는 표시를 붙입니다.
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    c.say()
    c.ok(f"{len(rows)}편의 자리를 만들었습니다. (새로 만듦 {created}편 / 건너뜀 {skipped}편)")
    c.ok(f"일정표: {c.rel(csv_path)}")
    c.say()
    c.say("  다음 단계:")
    c.say("    원고를 쓰려면 →  python scripts/generate_week.py")
    c.get_logger().info(f"주간 편성 생성 {wid}: {len(rows)}편")
    return wdir


def main() -> None:
    ap = argparse.ArgumentParser(description="주간 편성을 만듭니다.")
    ap.add_argument("--week", help="주차 (예: 2026-W36). 생략하면 다음 주.")
    ap.add_argument("--force", action="store_true",
                    help="폴더가 이미 있어도 진행합니다. 기존 원고는 덮어쓰지 않습니다.")
    args = ap.parse_args()
    try:
        build_week(args.week, args.force)
    except c.ConfigError as e:
        c.error(str(e))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
