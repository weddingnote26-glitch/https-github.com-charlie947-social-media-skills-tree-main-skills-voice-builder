# -*- coding: utf-8 -*-
"""
브라우저 예약 등록 보조 — 선택 기능입니다. 기본값은 꺼져 있습니다.

════════════════════════════════════════════════════════════════
 먼저 읽어 주세요
════════════════════════════════════════════════════════════════
 네이버는 2020년 5월 블로그 글쓰기 API를 종료했습니다.
 종료 이유는 "광고성 글을 API로 대량 제작·게재하는 것을 막기 위해" 였습니다.
 즉 네이버는 자동 대량 발행을 원하지 않습니다.

 그래서 이 기능은 이렇게 만들었습니다.
   · 기본값은 꺼짐입니다.
   · 한 번에 1편만 다룹니다.
   · 승인(approved)된 글만 다룹니다.
   · 로그인은 사람이 직접 합니다. 아이디·비밀번호를 저장하지 않습니다.
   · CAPTCHA·본인인증·보안경고가 보이면 그 자리에서 멈춥니다.
   · 화면 구조가 확인한 것과 다르면 아무것도 누르지 않고 멈춥니다.
   · 처음에는 비공개로만 올립니다.
   · 사람의 최종 확인 없이 공개 발행하지 않습니다.

 이 기능을 쓰지 않아도 됩니다.
 `python scripts/prepare_publish.py` 로 만든 발행 카드를 보고
 직접 붙여넣는 방식이 가장 안전합니다.
════════════════════════════════════════════════════════════════

실행
  python scripts/browser_publish.py --check                 로그인·채널 확인
  python scripts/browser_publish.py --calibrate             화면 구조 확인
  python scripts/browser_publish.py --run --post <게시물ID>  1편 예약 등록
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts.postfile import PostFile      # noqa: E402

SELECTOR_PATH = c.CONFIG_DIR / "naver_selectors.yaml"

REQUIRED_KEYS = ["title_input", "body_input", "publish_button",
                 "schedule_toggle", "schedule_date", "schedule_time"]


class Abort(RuntimeError):
    """멈춰야 하는 상황."""


# ──────────────────────────────────────────────────────────────
def load_browser_settings() -> dict:
    settings = c.load_settings()
    b = settings.get("browser") or {}
    if not b.get("enabled"):
        raise Abort(
            "브라우저 기능이 꺼져 있습니다.\n"
            "      켜려면 config/settings.yaml 에서 browser.enabled 를 true 로 바꾸세요.\n"
            "      다만 켜기 전에 이 파일 맨 위의 설명을 꼭 읽어 주세요."
        )
    return b


def require_playwright():
    try:
        from playwright.sync_api import sync_playwright
        return sync_playwright
    except ImportError:
        raise Abort(
            "playwright 가 설치되어 있지 않습니다.\n"
            "      설치:\n"
            "        pip install playwright\n"
            "        python -m playwright install chromium"
        )


def open_browser(b: dict):
    """사람이 직접 로그인한 상태가 유지되는 브라우저를 엽니다."""
    sync_playwright = require_playwright()
    profile = c.PROJECT_ROOT / b.get("profile_dir", "private/browser-profile")
    c.ensure_dir(profile)

    pw = sync_playwright().start()
    ctx = pw.chromium.launch_persistent_context(
        user_data_dir=str(profile),
        headless=bool(b.get("headless", False)),
        locale="ko-KR",
        timezone_id="Asia/Seoul",
        viewport={"width": 1440, "height": 960},
    )
    return pw, ctx


def guard_human_needed(page, sel_cfg: dict) -> None:
    """CAPTCHA·본인인증·보안 경고가 보이면 멈춥니다. 절대 우회하지 않습니다."""
    markers = (sel_cfg.get("login_markers") or {}).get("needs_human") or []
    try:
        text = page.inner_text("body", timeout=3000)
    except Exception:
        return
    for m in markers:
        if m in text:
            raise Abort(
                f"화면에 「{m}」 관련 안내가 보입니다.\n"
                f"      본인인증이나 보안 확인이 필요한 상황입니다.\n"
                f"      이런 절차는 우회하지 않습니다. 브라우저에서 직접 처리해 주세요."
            )


def wait_for_login(page, blog_id: str, sel_cfg: dict, timeout_sec: int = 300) -> None:
    """사람이 로그인할 때까지 기다립니다. 아이디·비밀번호는 다루지 않습니다."""
    out_markers = (sel_cfg.get("login_markers") or {}).get(
        "logged_out_url_contains") or []
    c.say()
    c.say("  ┌──────────────────────────────────────────────────────┐")
    c.say("  │  브라우저에서 네이버에 직접 로그인해 주세요.         │")
    c.say("  │  이 프로그램은 아이디와 비밀번호를 다루지 않습니다.  │")
    c.say("  └──────────────────────────────────────────────────────┘")
    c.say()
    c.say(f"    로그인 후 {blog_id} 블로그로 이동하면 자동으로 넘어갑니다.")
    c.say(f"    (최대 {timeout_sec // 60}분 기다립니다)")
    c.say()

    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        guard_human_needed(page, sel_cfg)
        url = page.url
        if not any(m in url for m in out_markers):
            if blog_id in url:
                c.ok("로그인이 확인되었습니다.")
                return
        time.sleep(2)
    raise Abort("로그인을 기다리다 시간이 다 되었습니다. 다시 실행해 주세요.")


def verify_channel(page, ch: dict) -> None:
    """지금 열린 블로그가 올리려는 채널이 맞는지 확인합니다."""
    if ch["blog_id"] not in page.url:
        raise Abort(
            f"지금 열린 주소가 올리려는 블로그와 다릅니다.\n"
            f"      올리려는 곳 : {ch['name']} ({ch['blog_id']})\n"
            f"      지금 주소    : {page.url}\n"
            f"      채널이 뒤바뀌는 것을 막기 위해 멈췄습니다."
        )
    c.ok(f"채널 확인: {ch['name']} ({ch['blog_id']})")


# ──────────────────────────────────────────────────────────────
def cmd_check(args) -> None:
    b = load_browser_settings()
    ch = c.get_channel(args.channel)
    sel_cfg = c.read_yaml(SELECTOR_PATH, default={}) or {}

    c.header("로그인·채널 확인")
    pw, ctx = open_browser(b)
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(ch["url"], wait_until="domcontentloaded")
        wait_for_login(page, ch["blog_id"], sel_cfg)
        verify_channel(page, ch)
        c.say()
        c.ok("확인이 끝났습니다. 로그인 상태는 이 PC에만 저장됩니다.")
        c.say(f"      저장 위치: {b.get('profile_dir')} (동기화하지 않는 폴더)")
    finally:
        ctx.close(); pw.stop()


def cmd_calibrate(args) -> None:
    """실제 화면에서 요소를 찾아 위치표를 확인합니다."""
    b = load_browser_settings()
    ch = c.get_channel(args.channel)
    sel_cfg = c.read_yaml(SELECTOR_PATH, default={}) or {}

    c.header("네이버 글쓰기 화면 구조 확인")
    c.say()
    c.say("  네이버 화면은 수시로 바뀝니다.")
    c.say("  추측한 위치로 자동 조작하면 엉뚱한 곳을 누를 수 있어,")
    c.say("  실제 화면에서 하나씩 찾아 확인한 뒤에만 자동 입력을 허용합니다.")
    c.say()

    editor = sel_cfg.get("editor") or {}
    unset = [k for k in REQUIRED_KEYS if not editor.get(k)]
    if unset:
        c.warn("아직 위치표가 비어 있습니다.")
        c.say()
        c.say("      다음 항목의 위치를 아직 모릅니다:")
        for k in unset:
            c.say(f"        · {k}")
        c.say()
        c.say("      브라우저를 열어 드릴 테니, 글쓰기 화면에서")
        c.say("      F12(개발자도구) → 요소 선택으로 각 항목의 선택자를 확인해")
        c.say(f"      {c.rel(SELECTOR_PATH)} 의 editor: 아래에 적어 주세요.")
        c.say()
        c.say("      잘 모르시겠다면 이 기능을 쓰지 않아도 됩니다.")
        c.say("      발행 카드를 보고 직접 붙여넣는 쪽이 더 안전하고 빠릅니다.")
        c.say()
        if not c.confirm("  그래도 브라우저를 열어 확인해 보시겠습니까?"):
            return

    pw, ctx = open_browser(b)
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        write_url = (sel_cfg.get("urls") or {}).get(
            "write", "https://blog.naver.com/{blog_id}?Redirect=Write")
        page.goto(ch["url"], wait_until="domcontentloaded")
        wait_for_login(page, ch["blog_id"], sel_cfg)
        page.goto(write_url.format(blog_id=ch["blog_id"]),
                  wait_until="domcontentloaded")
        guard_human_needed(page, sel_cfg)

        c.say()
        c.info("글쓰기 화면을 열었습니다. 요소를 확인합니다 …")

        log, found, missing = [], [], []
        for key in REQUIRED_KEYS:
            sel = editor.get(key)
            if not sel:
                missing.append(key)
                log.append({"key": key, "selector": None, "result": "선택자 없음"})
                continue
            try:
                page.wait_for_selector(sel, timeout=5000, state="attached")
                found.append(key)
                log.append({"key": key, "selector": sel, "result": "찾음"})
                c.ok(f"{key} — 찾았습니다")
            except Exception:
                missing.append(key)
                log.append({"key": key, "selector": sel, "result": "찾지 못함"})
                c.warn(f"{key} — 찾지 못했습니다 ({sel})")

        sel_cfg["calibration_log"] = log
        sel_cfg["verified"] = not missing
        sel_cfg["verified_at"] = c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST")
        sel_cfg["verified_on"] = c.load_settings().get("machine_name", "")
        c.write_yaml(SELECTOR_PATH, sel_cfg)

        c.say()
        if missing:
            c.warn(f"{len(missing)}개 항목을 찾지 못해 자동 입력을 켜지 않았습니다.")
            c.say("      네이버가 화면을 바꿨거나 선택자가 아직 비어 있습니다.")
            c.say("      발행 카드를 보고 직접 붙여넣어 주세요.")
        else:
            c.ok("모든 항목을 찾았습니다. 자동 입력을 쓸 수 있습니다.")
            c.say("      다만 처음에는 반드시 비공개로 1편만 시험해 주세요.")
    finally:
        ctx.close(); pw.stop()


def cmd_run(args) -> None:
    b = load_browser_settings()
    sel_cfg = c.read_yaml(SELECTOR_PATH, default={}) or {}

    c.header("예약 등록")

    if not sel_cfg.get("verified"):
        raise Abort(
            "화면 구조가 아직 확인되지 않았습니다.\n"
            "      먼저 실행해 주세요:  python scripts/browser_publish.py --calibrate\n"
            "\n"
            "      확인 전에는 자동 입력을 하지 않습니다.\n"
            "      추측한 위치를 눌렀다가 엉뚱한 글이 올라가는 것을 막기 위해서입니다.\n"
            "      지금 바로 올리시려면 발행 카드를 보고 직접 붙여넣어 주세요:\n"
            "        python scripts/prepare_publish.py"
        )

    from scripts.generate_week import resolve_week
    wdir = resolve_week(args.week)

    target = None
    for meta_path in wdir.rglob("metadata.yaml"):
        meta = c.read_yaml(meta_path, default={}) or {}
        if meta.get("post_id") == args.post:
            target = (meta_path.parent, meta)
            break
    if not target:
        raise Abort(f"게시물을 찾지 못했습니다: {args.post}")

    pdir, meta = target
    if meta.get("status") != "approved":
        raise Abort(
            f"승인된 글만 등록할 수 있습니다.\n"
            f"      지금 상태: {c.STATUS_KO.get(meta.get('status'), meta.get('status'))}\n"
            f"      승인하려면:  python scripts/approve.py --post {args.post}"
        )

    ch = c.get_channel(pdir.parent.name)
    post = PostFile.load(pdir / "post.md")

    if str(post.get("blog_id")) != ch["blog_id"]:
        raise Abort("원고의 블로그 ID가 설정과 다릅니다. 채널 확인이 필요합니다.")

    # 처음에는 무조건 비공개
    visibility = b.get("first_run_visibility", "closed")
    max_posts = int(b.get("max_posts_per_run", 1))
    if max_posts != 1:
        c.warn(f"한 번에 {max_posts}편으로 설정되어 있습니다. "
               f"처음에는 1편을 권합니다.")

    c.say()
    c.say("  ┌──────────────────────────────────────────────────────┐")
    c.say("  │  아래 내용으로 예약을 등록합니다. 확인해 주세요.     │")
    c.say("  └──────────────────────────────────────────────────────┘")
    c.say()
    c.say(f"    채널       : {ch['name']} ({ch['blog_id']})")
    c.say(f"    제목       : {post.get('title')}")
    c.say(f"    예약 일시  : {post.get('publish_date')} {post.get('publish_time')} KST")
    c.say(f"    공개 범위  : {visibility}  ← 비공개로 올린 뒤 직접 확인하세요")
    c.say()

    if not args.confirm and not c.confirm("  이대로 진행할까요?"):
        c.info("취소했습니다.")
        return

    pw, ctx = open_browser(b)
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(ch["url"], wait_until="domcontentloaded")
        wait_for_login(page, ch["blog_id"], sel_cfg)
        verify_channel(page, ch)

        write_url = (sel_cfg.get("urls") or {})["write"].format(blog_id=ch["blog_id"])
        page.goto(write_url, wait_until="domcontentloaded")
        guard_human_needed(page, sel_cfg)

        editor = sel_cfg["editor"]
        delay = float(b.get("step_delay_seconds", 1.5))

        # 매 단계마다 요소가 실제로 있는지 다시 확인합니다.
        # 하나라도 없으면 아무것도 누르지 않고 멈춥니다.
        for key in REQUIRED_KEYS:
            try:
                page.wait_for_selector(editor[key], timeout=5000, state="attached")
            except Exception:
                raise Abort(
                    f"화면 구조가 확인했던 것과 다릅니다: {key}\n"
                    f"      네이버가 화면을 바꾼 것 같습니다.\n"
                    f"      아무것도 입력하지 않고 멈췄습니다.\n"
                    f"      다시 확인해 주세요: python scripts/browser_publish.py --calibrate"
                )

        c.info("제목을 입력합니다 …")
        page.fill(editor["title_input"], str(post.get("title")))
        time.sleep(delay)

        c.info("본문을 입력합니다 …")
        page.fill(editor["body_input"], post.body)
        time.sleep(delay)

        guard_human_needed(page, sel_cfg)

        c.info("예약 설정을 엽니다 …")
        page.click(editor["publish_button"])
        time.sleep(delay)
        page.click(editor["schedule_toggle"])
        time.sleep(delay)
        page.fill(editor["schedule_date"], str(post.get("publish_date")))
        page.fill(editor["schedule_time"], str(post.get("publish_time")))
        time.sleep(delay)

        if visibility == "closed" and editor.get("visibility_closed"):
            page.click(editor["visibility_closed"])
            time.sleep(delay)

        c.say()
        c.say("  ┌──────────────────────────────────────────────────────┐")
        c.say("  │  마지막 확인입니다.                                  │")
        c.say("  │  브라우저 화면을 직접 보고 확인해 주세요.            │")
        c.say("  └──────────────────────────────────────────────────────┘")
        c.say()
        c.say(f"    채널      : {ch['confirm_phrase']}")
        c.say(f"    예약 일시 : {post.get('publish_date')} {post.get('publish_time')}")
        c.say(f"    공개 범위 : {visibility}")
        c.say()

        if not c.confirm("  예약을 저장할까요? (브라우저 화면을 보고 답해 주세요)"):
            c.info("저장하지 않았습니다. 브라우저는 열어 둡니다.")
            input("  확인했으면 Enter 를 눌러 주세요 …")
            return

        page.click(editor["confirm_button"])
        time.sleep(delay * 2)

        now = c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST")
        meta["status"] = "scheduled"
        meta.setdefault("scheduled", {}).update({
            "registered": True, "registered_at": now, "method": "browser",
        })
        meta.setdefault("history", []).append({
            "status": "scheduled", "at": now, "by": "browser_publish.py",
            "note": f"브라우저로 예약 등록 ({visibility})",
        })
        c.write_yaml(pdir / "metadata.yaml", meta)

        c.say()
        c.ok(f"{args.post} — 예약을 등록했습니다.")
        c.say("      네이버에서 예약 목록을 직접 확인해 주세요.")
        c.say("      비공개로 올렸다면, 확인 후 공개로 바꾸는 것은 직접 해주세요.")
        c.get_logger().info(f"브라우저 예약 등록: {args.post}")
    finally:
        ctx.close(); pw.stop()


# ──────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(
        description="브라우저로 네이버 예약 등록을 돕습니다. (선택 기능)")
    ap.add_argument("--check", action="store_true", help="로그인·채널만 확인")
    ap.add_argument("--calibrate", action="store_true", help="화면 구조 확인")
    ap.add_argument("--run", action="store_true", help="예약 등록 실행")
    ap.add_argument("--post", help="게시물 ID (--run 에 필요)")
    ap.add_argument("--week")
    ap.add_argument("--channel", default="coin", choices=["coin", "stock"])
    ap.add_argument("--confirm", action="store_true",
                    help="시작 확인 질문을 건너뜁니다 (마지막 확인은 그대로 남습니다)")
    args = ap.parse_args()

    try:
        if args.check:
            cmd_check(args)
        elif args.calibrate:
            cmd_calibrate(args)
        elif args.run:
            if not args.post:
                raise Abort("--post <게시물ID> 를 함께 적어 주세요.")
            cmd_run(args)
        else:
            ap.print_help()
    except Abort as e:
        c.say()
        c.error(str(e))
        raise SystemExit(1)
    except c.ConfigError as e:
        c.error(str(e))
        raise SystemExit(1)
    except KeyboardInterrupt:
        c.say()
        c.info("사용자가 중단했습니다.")
        raise SystemExit(130)


if __name__ == "__main__":
    main()
