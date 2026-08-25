# -*- coding: utf-8 -*-
"""
화면(GUI) 로직 검사 — 네트워크·브라우저·네이버 없이 돌아갑니다.

실행:  .venv\\Scripts\\python.exe scripts\\test_gui_logic.py
"""
from __future__ import annotations

import datetime as dt
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from gui import state  # noqa: E402

PASS = 0
FAIL: list[str] = []


def check(name: str, cond: bool, note: str = "") -> None:
    global PASS
    if cond:
        PASS += 1
        print(f"  통과  {name}")
    else:
        FAIL.append(name)
        print(f"  실패  {name}  {note}")


def make_post(root: Path, ch: str, date: str, status: str = "draft",
              time_: str = "08:30", review: bool = False,
              images: list[str] | None = None,
              have: list[str] | None = None) -> Path:
    d = root / "output" / "2026-W40" / ch / date
    d.mkdir(parents=True, exist_ok=True)
    img_fm = ""
    if images:
        img_fm = "images:\n" + "".join(
            f"- file: {f}\n  position: 본문\n  alt: 설명 {f}\n  kind: 설명이미지\n"
            for f in images)
    (d / "post.md").write_text(
        f"---\ntitle: '검사용 글 {ch} {date}'\n{img_fm}---\n본문입니다.\n\n"
        "#태그1 #태그2\n\n(※ 유의 문구)\n", encoding="utf-8")
    (d / "metadata.yaml").write_text(
        f"post_id: {ch}-{date}-검사\n"
        f"title: '검사용 글 {ch} {date}'\n"
        f"status: {status}\n"
        f"review:\n  passed: {'true' if review else 'false'}\n"
        f"publish:\n  date: '{date}'\n  time: '{time_}'\n  weekday: 월\n"
        f"  visibility: closed\n", encoding="utf-8")
    for f in (have or []):
        (d / "images").mkdir(exist_ok=True)
        (d / "images" / f).write_bytes(b"\x89PNG\r\n\x1a\n")
    return d


def main() -> int:  # noqa: PLR0915
    tmp = Path(tempfile.mkdtemp(prefix="nba_gui_test_"))
    today = state.now_kst().strftime("%Y-%m-%d")
    try:
        # ══ 1·2) 예약 버튼이 부르는 프로그램과 인자 ══════════════
        src = (ROOT / "gui" / "screens.py").read_text(encoding="utf-8")
        pub_cls = src[src.index("class PublishManageScreen"):src.index("class HistoryScreen")]
        check("1. 예약 흐름에서 schedule_week.py 를 부르지 않음",
              "schedule_week" not in pub_cls)
        check("1b. 예약 스크립트 상수가 browser_publish.py",
              state.RESERVE_SCRIPT == "browser_publish.py")
        check("2. 예약 실행에 --reserve 와 --post(게시물 ID)를 전달",
              '"--reserve", "--post", p.post_id' in pub_cls
              and '"--channel", p.channel' in pub_cls)

        # ══ 3) 오늘 날짜여도 예약 확인 전이면 '오늘 예약된 글' 아님 ══
        make_post(tmp, "coin", today, status="draft")
        make_post(tmp, "stock", today, status="reservation_verified", review=True)
        rows = state.posts(week="2026-W40", root=tmp)
        sched = state.today_scheduled(rows)
        check("3. 오늘 예약된 글 = 예약 확인됨(reservation_verified)만",
              len(sched) == 1 and sched[0].channel == "stock",
              f"결과 {len(sched)}건")

        # ══ 4) 확인 전에는 '예약 확인됨'·'발행됨' 표시가 안 나옴 ══
        req = [p for p in rows if p.channel == "coin"][0]
        check("4a. draft 는 '원고 작성됨'으로 표시", req.status == "원고 작성됨", req.status)
        check("4b. '예약 확인됨'은 reservation_verified 에서만",
              state.status_ko("reservation_requested") != "예약 확인됨"
              and state.status_ko("reservation_verified") == "예약 확인됨")
        check("4c. 요청 상태는 '네이버 확인 필요'가 붙음",
              "확인 필요" in state.status_ko("reservation_requested"))
        check("4d. published 도 확인 전 문구가 붙음",
              "확인 필요" in state.status_ko("published"))
        check("4e. 옛 'scheduled' 값은 알 수 없는 상태로 표시",
              "알 수 없는" in state.status_ko("scheduled"))

        # ══ 5) 이미지 누락·순서 ════════════════════════════════
        d5 = make_post(tmp, "coin", "2026-09-30", images=["a.png", "b.png", "c.png"],
                       have=["a.png", "c.png"])
        p5 = [p for p in state.posts(week="2026-W40", root=tmp)
              if p.folder == d5][0]
        check("5a. 이미지 누락 집계 (2/3)", (p5.images_have, p5.images_need) == (2, 3),
              f"{p5.images_have}/{p5.images_need}")
        ok, err = state.save_image_order(d5, ["c.png", "a.png", "b.png"])
        fm = state.front_matter(d5 / "post.md")
        order = [i["file"] for i in fm["images"]]
        check("5b. 이미지 순서 저장", ok and order == ["c.png", "a.png", "b.png"], err or str(order))
        check("5c. 순서 저장 후에도 alt 보존",
              fm["images"][0].get("alt", "").startswith("설명"))
        ok2, err2 = state.save_image_order(d5, ["c.png", "a.png"])
        check("5d. 목록과 다른 순서는 거부", not ok2, err2)

        # ══ 6) 예약 전 검사 ════════════════════════════════════
        conf_on = {"browser": {"enabled": True},
                   "schedule": {"min_gap_hours": 12, "min_lead_hours": 1}}
        conf_off = {"browser": {"enabled": False},
                    "schedule": {"min_gap_hours": 12, "min_lead_hours": 1}}
        rp = make_post(tmp, "coin", "2026-10-01", status="draft_saved", review=True)
        post = [p for p in state.posts(week="2026-W40", root=tmp) if p.folder == rp][0]
        now = state.now_kst()
        past = now - dt.timedelta(hours=1)
        soon = now + dt.timedelta(minutes=20)
        okt = now + dt.timedelta(hours=30)
        check("6a. 지난 시각 예약 차단",
              any("이미 지났" in x for x in state.reserve_check(post, past, [], conf_on)))
        check("6b. 준비 시간(1시간) 안 되면 차단",
              any("최소" in x for x in state.reserve_check(post, soon, [], conf_on)))
        check("6c. 브라우저 꺼짐이면 차단 사유에 표시",
              any("꺼져" in x for x in state.reserve_check(post, okt, [], conf_off)))
        other = [p for p in state.posts(week="2026-W40", root=tmp)
                 if p.raw_status == "reservation_verified"]
        other[0].publish_time = okt.strftime("%H:%M")
        other[0].date = okt.strftime("%Y-%m-%d")
        check("6d. 같은 시각 중복 예약 차단",
              any("같은 시각" in x for x in state.reserve_check(post, okt, other, conf_on)))
        check("6e. 통과하는 경우는 문제 없음",
              state.reserve_check(post, okt, [], conf_on) == [])
        check("6f. draft 상태는 예약 불가",
              any("예약할 수 없" in x
                  for x in state.reserve_check(req, okt, [], conf_on)))

        # ══ 7) 설정 저장 — 주석 보존·즉시 반영·검증 ═════════════
        s7 = tmp / "settings.yaml"
        shutil.copy2(ROOT / "config" / "settings.yaml", s7)
        vals = dict(coin_time="09:15", stock_time="06:45", holiday=False,
                    gap_hours=10, lead_hours=2, browser_on=True,
                    account_mode="separate_accounts", max_posts=2)
        ok, err = state.save_settings(vals, path=s7)
        text = s7.read_text(encoding="utf-8")
        import yaml
        loaded = yaml.safe_load(text)
        check("7a. 설정 저장 성공", ok, err)
        check("7b. 값이 실제로 바뀜",
              loaded["publish_times"]["coin"] == "09:15"
              and loaded["schedule"]["min_gap_hours"] == 10
              and loaded["browser"]["enabled"] is True
              and loaded["browser"]["account_mode"] == "separate_accounts")
        check("7c. 파일의 설명(주석)이 그대로 남음",
              "이 PC를 구분하는 이름" in text and "기본값은 꺼짐입니다" in text)
        bad = dict(vals, coin_time="25:99")
        ok_b, err_b = state.save_settings(bad, path=s7)
        check("7d. 잘못된 값은 저장 전에 거부", not ok_b and "올바르지" in err_b, err_b)

        # ══ 8) 원고 저장 — 형식 보존 ═══════════════════════════
        d8 = make_post(tmp, "stock", "2026-10-02", images=["x.png"])
        fm_before, _ = state.split_post(d8 / "post.md")
        ok, err = state.save_post(d8, "고친 제목 'test'", "고친 본문입니다.\n\n#새태그\n")
        fm_after, body_after = state.split_post(d8 / "post.md")
        check("8a. 원고 저장 성공", ok, err)
        check("8b. 제목이 앞머리에 반영", "고친 제목" in fm_after)
        check("8c. 제목 외 앞머리 줄은 글자 그대로 보존",
              [l for l in fm_before.splitlines() if not l.startswith("title:")]
              == [l for l in fm_after.splitlines() if not l.startswith("title:")])
        check("8d. 본문 교체 반영", "고친 본문" in body_after)
        check("8e. metadata.yaml 제목도 함께 갱신",
              "고친 제목" in str(state._yaml(d8 / "metadata.yaml").get("title")))
        check("8f. 저장 전 내용이 .bak 으로 남음", (d8 / "post.md.bak").exists())

        # ══ 9·10) 화면 호출 시 승인 관문 ═══════════════════════
        code = ("import os, sys; sys.path.insert(0, r'%s'); "
                "from scripts import common as c; "
                "print(int(c.confirm('t')))" % (ROOT / "scripts"))
        env = dict(os.environ, NBA_GUI="1", PYTHONIOENCODING="utf-8")
        env.pop("NBA_CONFIRMED", None)
        r1 = subprocess.run([sys.executable, "-c", code], capture_output=True,
                            text=True, env=env, cwd=ROOT)
        r2 = subprocess.run([sys.executable, "-c", code], capture_output=True,
                            text=True, env=dict(env, NBA_CONFIRMED="1"), cwd=ROOT)
        check("9. 화면 호출 + 확인 없음 → confirm 은 항상 아니오",
              r1.stdout.strip().endswith("0"), r1.stdout + r1.stderr)
        check("10. 화면에서 확인을 누른 경우에만 예",
              r2.stdout.strip().endswith("1"), r2.stdout + r2.stderr)
        bp = (ROOT / "scripts" / "browser_publish.py").read_text(encoding="utf-8")
        check("10b. 채움·예약 단계에 사람·화면 구조 검사(guard_human)가 있음",
              bp.count("guard_human(") >= 2)
        check("10c. GUI 에서 죽던 input() 대기가 없음",
              "input(\"  확인이" not in bp)

        # ══ 11·12) 화면 스모크 (탭 이동·최소 크기) ═════════════
        from PySide6.QtWidgets import QApplication
        app = QApplication.instance() or QApplication([])
        from gui import theme
        app.setStyleSheet(theme.stylesheet())
        from gui.main import MainWindow, MENU
        w = MainWindow()
        errs = []
        for name, _cls in MENU:
            try:
                w.go(name)
            except Exception as e:  # noqa: BLE001
                errs.append(f"{name}: {e}")
        check("11a. 7개 화면 모두 열림", not errs, "; ".join(errs))
        check("11b. 표가 키보드 탭 이동을 받음",
              all(t.tabKeyNavigation() is not None for t in
                  w.screens["발행 관리"].tables))
        check("12. 최소 창 크기 1000x700",
              (w.minimumSize().width(), w.minimumSize().height()) == (1000, 700))
        pub = w.screens["발행 관리"]
        check("12b. 발행 관리 탭 4개(대기·예약·확인·실패)",
              [pub.tabs.tabText(i).split(" ")[0] for i in range(4)]
              == ["발행", "예약됨", "확인", "실패"])
        w.close()

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("  " + "─" * 52)
    if FAIL:
        print(f"  ❌ {len(FAIL)}개 실패 / {PASS}개 통과")
        return 1
    print(f"  ✅ {PASS}개 전부 통과")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
