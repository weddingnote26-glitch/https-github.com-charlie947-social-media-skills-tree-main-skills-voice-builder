# -*- coding: utf-8 -*-
"""
실행 메뉴 — 번호만 고르면 됩니다.

실행:  python scripts/menu.py
       (또는 run.ps1 을 두 번 클릭)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c  # noqa: E402

PY = sys.executable or "python"


def run(script: str, *args: str) -> int:
    """스크립트를 실행하고 화면에 그대로 보여줍니다."""
    cmd = [PY, str(c.PROJECT_ROOT / "scripts" / script), *args]
    try:
        return subprocess.call(cmd, cwd=str(c.PROJECT_ROOT))
    except KeyboardInterrupt:
        c.say()
        c.info("중단했습니다.")
        return 130
    except OSError as e:
        c.error(f"실행할 수 없습니다: {e}")
        return 1


def pause() -> None:
    c.say()
    try:
        input("  계속하려면 Enter 를 눌러 주세요 …")
    except EOFError:
        raise c.InputClosed
    except KeyboardInterrupt:
        pass


def show_state() -> None:
    """맨 위에 지금 상황을 간단히 보여줍니다."""
    try:
        weeks = sorted((p for p in c.OUTPUT_DIR.iterdir()
                        if p.is_dir() and p.name.startswith("20")),
                       key=lambda p: p.name)
    except FileNotFoundError:
        weeks = []
    if not weeks:
        c.say("  지금 만들어 둔 주차가 없습니다. 1번부터 시작하세요.")
        return

    wdir = weeks[-1]
    counts: dict[str, int] = {}
    for m in wdir.rglob("metadata.yaml"):
        meta = c.read_yaml(m, default={}) or {}
        s = meta.get("status", "draft")
        counts[s] = counts.get(s, 0) + 1
    parts = [f"{c.STATUS_KO.get(k, k)} {v}편"
             for k, v in sorted(counts.items(), key=lambda x: c.status_index(x[0]))]
    c.say(f"  이번 작업 주차: {wdir.name}   ({' · '.join(parts) or '비어 있음'})")

    unana = [c.get_channel(k)["name"] for k in ("coin", "stock")
             if c.style_status(k).get("status") != "analyzed"]
    if unana:
        c.say(f"  ⚠ 글 양식 미분석: {', '.join(unana)}  "
              f"(샘플을 주시면 분석해 드립니다)")


MENU = """
  1. 다음 주 콘텐츠 12편 생성
  2. 특정 게시물 다시 생성
  3. 전체 원고 검수
  4. 네이버 예약 발행 준비
  5. 승인된 글 예약 등록
  6. 발행 결과 확인
  7. 설정 변경
  8. 종료
"""


def menu_1() -> None:
    c.header("1. 다음 주 콘텐츠 12편 생성")
    c.say()
    c.say("  두 단계로 진행합니다.")
    c.say("    (1) 월~토 12편의 자리와 주제를 정합니다.")
    c.say("    (2) 원고를 씁니다.")
    c.say()
    if run("schedule_week.py") != 0:
        c.say()
        if c.confirm("  이미 만들어진 주차가 있습니다. 그대로 진행할까요?"):
            run("schedule_week.py", "--force")
        else:
            return
    c.say()
    run("generate_week.py")


def menu_2() -> None:
    c.header("2. 특정 게시물 다시 생성")
    run("publish_status.py")
    c.say()
    c.say("  다시 쓸 글의 발행 날짜와 채널을 알려 주세요.")
    date = c.ask("  날짜 (예: 2026-08-25)")
    if not date:
        return
    ch = c.ask("  채널 (coin=코인설명서 / stock=경제공부소)", "coin")
    if ch not in ("coin", "stock"):
        c.warn("coin 또는 stock 으로 적어 주세요.")
        return

    weeks = sorted((p for p in c.OUTPUT_DIR.iterdir() if p.is_dir()),
                   key=lambda p: p.name)
    pdir = None
    for w in reversed(weeks):
        cand = w / ch / date
        if cand.exists():
            pdir = cand
            break
    if not pdir:
        c.warn(f"{ch}/{date} 폴더를 찾지 못했습니다.")
        return

    post = pdir / "post.md"
    if post.exists():
        c.say()
        c.warn(f"기존 원고를 지우고 새로 씁니다: {c.rel(post)}")
        if not c.confirm("  정말 지울까요?"):
            return
        backup = pdir / f"post.backup-{c.now_kst():%Y%m%d-%H%M%S}.md"
        post.rename(backup)
        c.ok(f"기존 원고를 {backup.name} 로 옮겨 두었습니다.")
    run("generate_week.py", "--only", ch, "--date", date)


def menu_3() -> None:
    c.header("3. 전체 원고 검수")
    c.say()
    c.info("먼저 수치의 출처를 확인합니다 …")
    run("factcheck.py")
    c.say()
    c.info("이어서 14가지 항목을 검사합니다 …")
    run("review.py")


def menu_4() -> None:
    c.header("4. 네이버 예약 발행 준비")
    c.say()
    c.say("  검수를 통과한 글을 승인하고, 네이버에 올릴 자료를 만듭니다.")
    c.say()
    c.say("  ⚠ 네이버 스마트에디터는 HTML 글쓰기를 지원하지 않습니다.")
    c.say("     그래서 HTML을 붙여넣는 대신, 편집기에 그대로 옮길 수 있는")
    c.say("     순수 텍스트와 이미지 파일을 준비합니다.")
    c.say()
    if c.confirm("  먼저 승인 단계를 진행할까요?", default_yes=True):
        run("approve.py")
    c.say()
    c.info("중복·예약 충돌을 검사하고 업로드 패키지를 만듭니다 …")
    run("prepare_publish.py")


def menu_5() -> None:
    c.header("5. 승인된 글 예약 등록")
    c.say()
    c.say("  네이버에는 글을 자동으로 올려주는 공식 기능이 없습니다.")
    c.say("  (블로그 글쓰기 API는 2020년 5월에 종료되었습니다)")
    c.say()
    c.say("    A. 직접 올리기  — 가장 안전하고 확실합니다. (권장)")
    c.say("       체크리스트를 보고 편집기에 옮깁니다.")
    c.say()
    c.say("    B. 브라우저 보조 — 선택 기능. 기본값은 꺼져 있습니다.")
    c.say("       화면 구조를 먼저 확인해야 하고, 한 번에 1편만 다룹니다.")
    c.say()
    choice = c.ask("  어느 쪽으로 하시겠습니까? (A/B)", "A").upper()

    if choice == "B":
        c.say()
        c.warn("브라우저 보조는 계정에 불이익이 갈 수 있습니다.")
        c.say("      처음에는 반드시 비공개로 1편만 시험해 주세요.")
        c.say()
        c.say("  순서:")
        c.say("    1) 화면 구조 확인   --calibrate")
        c.say("    2) 입력 후 비공개 저장  --fill --post <ID>")
        c.say("    3) 예약 걸기        --reserve --post <ID>")
        c.say()
        run("browser_publish.py")
        return

    from scripts.generate_week import resolve_week
    try:
        wdir = resolve_week(None)
    except SystemExit as e:
        c.warn(str(e))
        return

    guide = wdir / "발행안내.md"
    if not guide.exists():
        c.warn("아직 발행 자료가 없습니다. 4번을 먼저 실행해 주세요.")
        return

    checklists = sorted(wdir.rglob("publish/upload_checklist.md"))
    c.say()
    c.ok(f"준비된 글 {len(checklists)}편")
    c.say()
    for i, ck in enumerate(checklists, 1):
        meta = c.read_yaml(ck.parent.parent / "metadata.yaml", default={}) or {}
        pub = meta.get("publish") or {}
        st = meta.get("status", "draft")
        c.say(f"    {i}. [{c.STATUS_MARK.get(st,'?')} {c.STATUS_KO.get(st,st)}] "
              f"{pub.get('date')} {pub.get('time')}  {c.clip(meta.get('title',''), 34)}")
        c.say(f"       → {c.rel(ck)}")
    c.say()
    c.say("  각 글의 체크리스트를 열어 0단계(블로그 ID 7가지 확인)부터")
    c.say("  차례대로 따라가시면 됩니다.")
    c.say()
    c.say("  ⚠ post.html 은 눈으로 보는 용도입니다. 붙여넣지 마세요.")
    c.say("  ⚠ 이미지는 편집기의 사진 단추(포토 업로더)로 올려 주세요.")


def menu_6() -> None:
    c.header("6. 발행 결과 확인")
    run("publish_status.py")
    c.say()
    c.say("  네이버에서 한 단계를 마칠 때마다 여기에 기록해 두면")
    c.say("  중간에 멈췄다가 다시 시작할 때 어디부터 할지 알 수 있습니다.")
    c.say()
    if not c.confirm("  방금 마친 단계를 기록할까요?"):
        return

    steps = [
        ("1", "editor_filled", "편집기에 입력을 마침"),
        ("2", "draft_saved", "비공개로 저장함"),
        ("3", "reservation_requested", "예약 버튼을 누름"),
        ("4", "reservation_verified", "예약 목록에서 확인함"),
        ("5", "published", "발행일이 지나 실제로 올라감"),
        ("6", "post_publish_verified", "올라간 글을 열어 확인함"),
        ("9", "failed", "문제가 생겨 멈춤"),
    ]
    c.say()
    for num, _, label in steps:
        c.say(f"    {num}. {label}")
    c.say()
    pick = c.ask("  번호")
    found = next((s for s in steps if s[0] == pick), None)
    if not found:
        c.warn("번호를 다시 골라 주세요.")
        return

    pid = c.ask("  게시물 ID")
    if not pid:
        return

    args = ["--post", pid]
    if found[1] == "failed":
        args.append("--fail")
        note = c.ask("  무슨 일이 있었나요 (없으면 Enter)")
        if note:
            args += ["--note", note]
    else:
        args += ["--set", found[1]]
        if found[1] in ("published", "post_publish_verified"):
            url = c.ask("  글 주소 (없으면 Enter)")
            if url:
                args += ["--url", url]
    run("publish_status.py", *args)


def menu_7() -> None:
    c.header("7. 설정 변경")
    path = c.CONFIG_DIR / "settings.yaml"
    c.say()
    c.say(f"  설정 파일: {c.rel(path)}")
    c.say()
    if not path.exists():
        c.warn("설정 파일이 없습니다. setup.ps1 을 먼저 실행해 주세요.")
        return
    c.say("  바꿀 수 있는 것들:")
    c.say("    · 예약 발행 시간 (publish_times)")
    c.say("    · 공휴일 발행 여부 (holidays)")
    c.say("    · 원고 생성 방식 (generation.mode)")
    c.say("    · 검수 기준 (review)")
    c.say("    · 브라우저 보조 기능 켜기/끄기 (browser.enabled)")
    c.say()
    c.say("  지금 설정:")
    for line in c.read_text(path).splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            c.say(f"    {line}")
    c.say()
    c.say("  메모장으로 열어 고친 뒤 저장하시면 됩니다.")
    if c.confirm("  지금 메모장으로 열까요?"):
        import os
        try:
            if os.name == "nt":
                os.startfile(str(path))  # type: ignore[attr-defined]
            else:
                subprocess.call(["xdg-open", str(path)])
        except Exception as e:
            c.warn(f"열지 못했습니다: {e}")
            c.say(f"      직접 열어 주세요: {path}")


HANDLERS = {
    "1": menu_1, "2": menu_2, "3": menu_3, "4": menu_4,
    "5": menu_5, "6": menu_6, "7": menu_7,
}


def main() -> None:
    while True:
        c.say()
        c.say("=" * 60)
        c.say("   네이버 블로그 주간 콘텐츠 제작 도우미")
        c.say("=" * 60)
        try:
            show_state()
        except Exception as e:
            c.warn(f"상태를 읽지 못했습니다: {e}")
        c.say(MENU)

        try:
            choice = c.ask("  번호를 고르세요")
        except c.InputClosed:
            c.say("  입력이 끝나 메뉴를 닫습니다.")
            return

        if choice in ("8", "q", "종료", "exit"):
            c.say()
            c.say("  수고하셨습니다.")
            return

        handler = HANDLERS.get(choice)
        if not handler:
            c.warn("1부터 8 사이의 번호를 골라 주세요.")
            continue

        try:
            handler()
        except c.InputClosed:
            c.say("  입력이 끝나 메뉴를 닫습니다.")
            return
        except c.ConfigError as e:
            c.error(str(e))
        except KeyboardInterrupt:
            c.say()
            c.info("중단했습니다.")
        except Exception as e:
            c.error(f"예상하지 못한 문제가 생겼습니다: {e}")
            c.say(f"      자세한 내용은 {c.rel(c.LOG_DIR)} 폴더의 기록을 봐주세요.")
            c.get_logger().exception("메뉴 실행 중 오류")

        try:
            pause()
        except c.InputClosed:
            return


if __name__ == "__main__":
    main()
