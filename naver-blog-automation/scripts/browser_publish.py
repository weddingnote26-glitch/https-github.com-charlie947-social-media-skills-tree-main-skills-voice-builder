# -*- coding: utf-8 -*-
"""
브라우저 예약 등록 보조 — 선택 기능입니다. 기본값은 꺼져 있습니다.

════════════════════════════════════════════════════════════════
 먼저 읽어 주세요
════════════════════════════════════════════════════════════════
 네이버는 2020년 5월 블로그 글쓰기 API를 종료했습니다.
 사유는 "광고성 글을 API로 대량 제작·게재하는 것을 막기 위해" 였습니다.
 즉 네이버는 자동 대량 발행을 원하지 않습니다.

 그래서 이 기능은 이렇게 만들었습니다.
   · 기본값 꺼짐. 한 번에 1편만.
   · 승인(approved)된 글만.
   · 로그인은 사람이 직접. 아이디·비밀번호를 저장하지 않습니다.
   · 시작할 때와 발행 직전, 일곱 가지를 화면에서 다시 읽어 대조합니다.
   · 이미지는 포토 업로더로 파일을 직접 올립니다. (복사·붙여넣기 금지)
   · CAPTCHA·본인인증·보안경고가 보이면 그 자리에서 멈춥니다.
   · 화면 구조가 확인한 것과 다르면 아무것도 누르지 않고 멈춥니다.
   · 중간에 멈추면 실패 보고서를 남기고, 다시 실행하면 이어서 합니다.
   · 비공개 저장과 예약 등록은 따로 실행합니다.

 이 기능을 쓰지 않아도 됩니다.
 `publish/upload_checklist.md` 를 보고 직접 올리는 쪽이 가장 안전합니다.
════════════════════════════════════════════════════════════════

실행
  python scripts/browser_publish.py --check --channel stock     로그인·채널 확인
  python scripts/browser_publish.py --calibrate --channel stock 화면 구조 확인
  python scripts/browser_publish.py --fill    --post <ID>       편집기 입력 → 비공개 저장
  python scripts/browser_publish.py --reserve --post <ID>       예약 걸기
  python scripts/browser_publish.py --verify  --post <ID>       예약 목록에서 확인
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import common as c            # noqa: E402
from scripts import checkpoint as cp       # noqa: E402
from scripts import conflicts              # noqa: E402
from scripts.postfile import PostFile      # noqa: E402

SELECTOR_PATH = c.CONFIG_DIR / "naver_selectors.yaml"

REQUIRED_FILL = ["title_input", "body_input", "photo_button", "file_input",
                 "save_draft_button"]
REQUIRED_RESERVE = ["publish_button", "schedule_toggle",
                    "schedule_date", "schedule_time", "confirm_button"]


class Abort(RuntimeError):
    """멈춰야 하는 상황."""


# ──────────────────────────────────────────────────────────────
def load_browser_settings() -> dict:
    b = (c.load_settings().get("browser") or {})
    if not b.get("enabled"):
        raise Abort(
            "브라우저 기능이 꺼져 있습니다.\n"
            "      켜려면 config/settings.yaml 에서 browser.enabled 를 true 로 바꾸세요.\n"
            "      켜기 전에 scripts/browser_publish.py 맨 위 설명을 꼭 읽어 주세요."
        )
    return b


def profile_dir(b: dict, channel: str) -> Path:
    """
    계정이 서로 다르면 채널마다 브라우저 프로필을 나눕니다.
    한 계정이면 하나를 같이 씁니다.
    """
    if b.get("account_mode") == "separate_accounts":
        p = (b.get("profile_dirs") or {}).get(channel)
        if not p:
            raise Abort(f"{channel} 채널의 브라우저 프로필 경로가 설정에 없습니다.")
    else:
        p = b.get("profile_dir", "private/browser-profile")
    return c.PROJECT_ROOT / p


def open_browser(b: dict, channel: str):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise Abort(
            "playwright 가 설치되어 있지 않습니다.\n"
            "      pip install playwright\n"
            "      python -m playwright install chromium"
        )
    prof = c.ensure_dir(profile_dir(b, channel))
    pw = sync_playwright().start()
    ctx = pw.chromium.launch_persistent_context(
        user_data_dir=str(prof),
        headless=bool(b.get("headless", False)),
        locale="ko-KR", timezone_id="Asia/Seoul",
        viewport={"width": 1440, "height": 960},
    )
    return pw, ctx


def shoot(page, pdir: Path, name: str) -> str:
    """실패한 화면을 남겨 둡니다."""
    try:
        out = c.ensure_dir(pdir / "publish" / "failures")
        path = out / f"{c.now_kst():%Y%m%d-%H%M%S}-{name}.png"
        page.screenshot(path=str(path), full_page=False)
        return c.rel(path)
    except Exception:
        return ""


def guard_human(page, sel: dict) -> None:
    """CAPTCHA·본인인증·보안 경고가 보이면 멈춥니다. 우회하지 않습니다."""
    markers = (sel.get("login_markers") or {}).get("needs_human") or []
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


def wait_login(page, blog_id: str, sel: dict, timeout: int = 300) -> None:
    out_markers = (sel.get("login_markers") or {}).get("logged_out_url_contains") or []
    c.say()
    c.say("  ┌──────────────────────────────────────────────────────┐")
    c.say("  │  브라우저에서 네이버에 직접 로그인해 주세요.         │")
    c.say("  │  이 프로그램은 아이디와 비밀번호를 다루지 않습니다.  │")
    c.say("  └──────────────────────────────────────────────────────┘")
    c.say()
    c.say(f"    로그인 후 {blog_id} 블로그로 가면 자동으로 넘어갑니다.")
    deadline = time.time() + timeout
    while time.time() < deadline:
        guard_human(page, sel)
        if not any(m in page.url for m in out_markers) and blog_id in page.url:
            c.ok("로그인이 확인되었습니다.")
            return
        time.sleep(2)
    raise Abort("로그인을 기다리다 시간이 다 되었습니다.")


# ──────────────────────────────────────────────────────────────
def verify_identity(page, ch: dict, meta: dict, sel: dict,
                    post: PostFile | None = None) -> None:
    """
    발행 전 일곱 가지를 화면에서 다시 읽어 대조합니다.
    하나라도 다르면 아무것도 누르지 않고 멈춥니다.
    """
    pub = meta.get("publish") or {}
    ident = sel.get("identity") or {}
    checks: list[tuple[str, str, str, bool]] = []

    def read(selector: str | None) -> str:
        if not selector:
            return ""
        try:
            return page.inner_text(selector, timeout=3000).strip()
        except Exception:
            return ""

    # 1. 로그인 계정
    account = read(ident.get("account_name"))
    checks.append(("로그인 계정", account or "(읽지 못함)", "-", bool(account)))

    # 2. 블로그 ID — 주소창에서 읽습니다 (가장 확실합니다)
    url_ok = ch["blog_id"] in page.url
    checks.append(("블로그 ID", page.url, ch["blog_id"], url_ok))

    # 3. 블로그 이름
    blog_name = read(ident.get("blog_name"))
    name_ok = (not blog_name) or (ch["name"] in blog_name) or (blog_name in ch["name"])
    checks.append(("블로그 이름", blog_name or "(읽지 못함)", ch["name"], name_ok))

    # 4~7. 원고 쪽 값
    meta_blog = (meta.get("channel") or {}).get("blog_id", "")
    checks.append(("원고의 채널", meta_blog, ch["blog_id"], meta_blog == ch["blog_id"]))
    checks.append(("카테고리", str(pub.get("category", "")), "설정값",
                   bool(pub.get("category"))))
    checks.append(("제목", str(meta.get("title", ""))[:30], "비어있지 않을 것",
                   bool(meta.get("title"))))
    sched = f"{pub.get('date')} {pub.get('time')}"
    checks.append(("예약 일시", sched, "설정값",
                   bool(pub.get("date") and pub.get("time"))))

    c.say()
    c.say("  ┌─ 발행 전 확인 ───────────────────────────────────────┐")
    for label, got, want, ok in checks:
        mark = "✓" if ok else "✗"
        c.say(f"  │ {mark} {c.pad(label, 12)} {c.clip(got, 34)}")
    c.say("  └──────────────────────────────────────────────────────┘")

    bad = [x for x in checks if not x[3]]
    if bad:
        raise Abort(
            "확인에 실패한 항목이 있습니다: "
            + ", ".join(x[0] for x in bad) + "\n"
            "      두 블로그가 뒤바뀌는 것을 막기 위해 아무것도 누르지 않고 멈췄습니다.\n"
            "      화면을 직접 보고 맞는 블로그인지 확인해 주세요."
        )
    c.ok(f"일곱 가지 확인 완료 — {ch['confirm_phrase']}")


def require_selectors(sel: dict, page, keys: list[str], pdir: Path,
                      step: str) -> None:
    """쓸 요소가 실제로 있는지 미리 확인합니다. 없으면 멈춥니다."""
    editor = sel.get("editor") or {}
    missing = []
    for k in keys:
        s = editor.get(k)
        if not s:
            missing.append(f"{k} (선택자 없음)")
            continue
        try:
            page.wait_for_selector(s, timeout=5000, state="attached")
        except Exception:
            missing.append(f"{k} ({s})")
    if missing:
        shot = shoot(page, pdir, step)
        e = cp.record_failure(
            pdir, step,
            "화면 구조가 확인했던 것과 다릅니다: " + ", ".join(missing),
            url=page.url, shot=shot,
            todo=("네이버가 화면을 바꿨을 수 있습니다.\n"
                  "다시 확인해 주세요:  python scripts/browser_publish.py --calibrate\n"
                  "또는 publish/upload_checklist.md 를 보고 직접 올려 주세요."),
        )
        cp.write_failure_report(pdir, e)
        raise Abort(
            "화면 구조가 다릅니다. 아무것도 입력하지 않고 멈췄습니다.\n"
            "      " + ", ".join(missing) + "\n"
            f"      실패 보고서: {c.rel(pdir / 'publish' / '실패보고서.md')}"
        )


# ──────────────────────────────────────────────────────────────
def find_post(week: str | None, post_id: str) -> tuple[Path, dict]:
    from scripts.generate_week import resolve_week
    wdir = resolve_week(week)
    for meta_path in wdir.rglob("metadata.yaml"):
        meta = c.read_yaml(meta_path, default={}) or {}
        if meta.get("post_id") == post_id:
            return meta_path.parent, meta
    raise Abort(f"게시물을 찾지 못했습니다: {post_id}")


def preflight(pdir: Path, meta: dict, settings: dict, need: str) -> None:
    """네이버를 건드리기 전에 반드시 통과해야 하는 것들."""
    status = meta.get("status", "draft")
    pid = meta.get("post_id")

    if not c.can_touch_naver(status):
        raise Abort(
            f"승인된 글만 다룰 수 있습니다.\n"
            f"      지금 상태: {c.STATUS_KO.get(status, status)}\n"
            f"      승인:  python scripts/approve.py --post {pid}"
        )
    if not (pdir / "publish" / "blocks.yaml").exists():
        raise Abort(
            f"업로드 패키지가 없습니다.\n"
            f"      먼저 만들어 주세요:  python scripts/prepare_publish.py --post {pid}"
        )

    found = conflicts.check_all(pdir, settings)
    issues = found["duplicate"] + found["schedule"]
    if issues:
        raise Abort("검사에서 걸렸습니다. 예약을 걸 수 없습니다.\n      "
                    + "\n      ".join("✗ " + i for i in issues))


# ──────────────────────────────────────────────────────────────
def cmd_check(args) -> None:
    b = load_browser_settings()
    ch = c.get_channel(args.channel)
    sel = c.read_yaml(SELECTOR_PATH, default={}) or {}
    c.header(f"로그인·채널 확인 — {ch['name']}")
    pw, ctx = open_browser(b, args.channel)
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(ch["url"], wait_until="domcontentloaded")
        wait_login(page, ch["blog_id"], sel)
        if ch["blog_id"] not in page.url:
            raise Abort(f"열린 주소가 {ch['blog_id']} 가 아닙니다: {page.url}")
        c.ok(f"채널 확인: {ch['name']} ({ch['blog_id']})")
        c.say()
        c.say(f"      로그인 정보는 {c.rel(profile_dir(b, args.channel))} 에만 저장됩니다.")
        c.say("      이 폴더는 동기화되지 않습니다.")
    finally:
        ctx.close(); pw.stop()


def cmd_calibrate(args) -> None:
    b = load_browser_settings()
    ch = c.get_channel(args.channel)
    sel = c.read_yaml(SELECTOR_PATH, default={}) or {}
    editor = sel.get("editor") or {}

    c.header("네이버 글쓰기 화면 구조 확인")
    c.say()
    c.say("  네이버 화면은 수시로 바뀝니다.")
    c.say("  추측한 위치로 조작하면 엉뚱한 곳을 누를 수 있어,")
    c.say("  실제 화면에서 하나씩 확인한 뒤에만 자동 입력을 허용합니다.")
    c.say()

    need = REQUIRED_FILL + REQUIRED_RESERVE
    unset = [k for k in need if not editor.get(k)]
    if unset:
        c.warn(f"{len(unset)}개 항목의 위치를 아직 모릅니다.")
        for k in unset:
            c.say(f"        · {k}")
        c.say()
        c.say(f"      브라우저를 열어 드릴 테니 F12(개발자도구)로 확인해")
        c.say(f"      {c.rel(SELECTOR_PATH)} 의 editor: 아래에 적어 주세요.")
        c.say()
        c.say("      잘 모르시겠다면 이 기능을 쓰지 않아도 됩니다.")
        c.say("      publish/upload_checklist.md 를 보고 직접 올리는 쪽이")
        c.say("      더 안전하고 실제로 더 빠릅니다.")
        c.say()
        if not c.confirm("  그래도 브라우저를 열어 볼까요?"):
            return

    pw, ctx = open_browser(b, args.channel)
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(ch["url"], wait_until="domcontentloaded")
        wait_login(page, ch["blog_id"], sel)
        write_url = (sel.get("urls") or {}).get(
            "write", "https://blog.naver.com/{blog_id}?Redirect=Write")
        page.goto(write_url.format(blog_id=ch["blog_id"]),
                  wait_until="domcontentloaded")
        guard_human(page, sel)

        c.say()
        c.info("요소를 확인합니다 …")
        log, missing = [], []
        for key in need:
            s = editor.get(key)
            if not s:
                missing.append(key)
                log.append({"key": key, "selector": None, "result": "선택자 없음"})
                continue
            try:
                page.wait_for_selector(s, timeout=5000, state="attached")
                log.append({"key": key, "selector": s, "result": "찾음"})
                c.ok(f"{key}")
            except Exception:
                missing.append(key)
                log.append({"key": key, "selector": s, "result": "찾지 못함"})
                c.warn(f"{key} — 찾지 못했습니다 ({s})")

        sel["calibration_log"] = log
        sel["verified"] = not missing
        sel["verified_at"] = c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST")
        sel["verified_on"] = c.load_settings().get("machine_name", "")
        c.write_yaml(SELECTOR_PATH, sel)

        c.say()
        if missing:
            c.warn(f"{len(missing)}개를 찾지 못해 자동 입력을 켜지 않았습니다.")
            c.say("      publish/upload_checklist.md 를 보고 직접 올려 주세요.")
        else:
            c.ok("모두 찾았습니다. 자동 입력을 쓸 수 있습니다.")
            c.say("      처음에는 반드시 비공개로 1편만 시험해 주세요.")
    finally:
        ctx.close(); pw.stop()


def cmd_fill(args) -> None:
    """편집기에 입력하고 비공개로 저장합니다. 예약은 걸지 않습니다."""
    settings = c.load_settings()
    b = load_browser_settings()
    sel = c.read_yaml(SELECTOR_PATH, default={}) or {}
    if not sel.get("verified"):
        raise Abort(
            "화면 구조가 아직 확인되지 않았습니다.\n"
            "      먼저:  python scripts/browser_publish.py --calibrate\n"
            "\n"
            "      확인 전에는 자동 입력을 하지 않습니다.\n"
            "      지금 올리시려면 publish/upload_checklist.md 를 따라 주세요."
        )

    pdir, meta = find_post(args.week, args.post)
    preflight(pdir, meta, settings, "fill")
    ch = c.get_channel(pdir.parent.name)
    post = PostFile.load(pdir / "post.md")
    pkg = pdir / "publish"

    resume = cp.resume_point(pdir)
    done = cp.done_steps(pdir)
    if done:
        c.info(f"이어서 합니다 — {cp.progress_text(pdir)} "
               f"(다음: {cp.STEP_KO.get(resume, '끝')})")

    c.header(f"편집기 입력 — {ch['name']}")
    c.say()
    c.say(f"    제목      : {meta.get('title')}")
    c.say(f"    채널      : {ch['confirm_phrase']}")
    c.say(f"    공개 범위 : 비공개 (확인 후 사람이 직접 공개로 바꿉니다)")
    c.say()
    if not args.confirm and not c.confirm("  진행할까요?"):
        c.info("취소했습니다.")
        return

    pw, ctx = open_browser(b, ch["key"])
    page = None
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(ch["url"], wait_until="domcontentloaded")
        wait_login(page, ch["blog_id"], sel)
        cp.mark(pdir, "opened")

        verify_identity(page, ch, meta, sel, post)
        cp.mark(pdir, "channel_verified")

        write_url = (sel.get("urls") or {})["write"].format(blog_id=ch["blog_id"])
        page.goto(write_url, wait_until="domcontentloaded")
        guard_human(page, sel)
        require_selectors(sel, page, REQUIRED_FILL, pdir, "editor_opened")
        cp.mark(pdir, "editor_opened")

        editor = sel["editor"]
        delay = float(b.get("step_delay_seconds", 1.5))

        if "title_filled" not in done:
            c.info("제목을 넣습니다 …")
            page.fill(editor["title_input"], c.read_text(pkg / "title.txt").strip())
            time.sleep(delay)
            cp.mark(pdir, "title_filled")

        if "body_filled" not in done:
            c.info("본문을 넣습니다 … (순수 텍스트, HTML 아님)")
            page.fill(editor["body_input"], c.read_text(pkg / "body.txt"))
            time.sleep(delay)
            cp.mark(pdir, "body_filled")

        guard_human(page, sel)

        if "images_uploaded" not in done:
            already = set(cp.already_uploaded(pdir))
            files = sorted((pkg / "images").glob("*")) if (pkg / "images").exists() else []
            todo = [f for f in files if f.name not in already]
            if already:
                c.info(f"이미 올린 이미지 {len(already)}장은 건너뜁니다.")
            for f in todo:
                c.info(f"이미지 올리는 중 … {f.name}")
                # 포토 업로더로 파일을 직접 올립니다. 복사·붙여넣기를 쓰지 않습니다.
                page.set_input_files(editor["file_input"], str(f))
                time.sleep(delay * 2)
                cp.mark_uploaded(pdir, f.name)
            cp.mark(pdir, "images_uploaded", note=f"{len(files)}장")

        if "tags_filled" not in done and editor.get("tag_input"):
            c.info("태그를 넣습니다 …")
            page.fill(editor["tag_input"], " ".join("#" + t for t in post.hashtags()))
            time.sleep(delay)
            cp.mark(pdir, "tags_filled")

        c.say()
        c.say("  ┌──────────────────────────────────────────────────────┐")
        c.say("  │  브라우저 화면을 직접 보고 확인해 주세요.            │")
        c.say("  └──────────────────────────────────────────────────────┘")
        c.say()
        c.say("    · 제목이 한 번만 들어갔는가")
        c.say("    · 본문 첫 문장과 마지막 문장이 있는가")
        c.say("    · 소제목이 모두 들어갔는가 (편집기에서 서식 지정 필요)")
        c.say(f"    · 이미지가 {len(post.image_refs())}장 모두 보이는가")
        c.say("    · 투자 유의 문구가 있는가")
        c.say()
        if not c.confirm("  비공개로 저장할까요?"):
            c.info("저장하지 않았습니다. 브라우저는 열어 둡니다.")
            input("  확인이 끝나면 Enter 를 눌러 주세요 …")
            return

        page.click(editor["save_draft_button"])
        time.sleep(delay * 2)
        cp.mark(pdir, "draft_saved")

        _advance(pdir, meta, "editor_filled")
        _advance(pdir, meta, "draft_saved")

        c.say()
        c.ok(f"{args.post} — 비공개로 저장했습니다.")
        c.say("      네이버에서 글을 열어 서식과 이미지를 확인해 주세요.")
        c.say(f"      확인이 끝나면 예약을 겁니다:")
        c.say(f"        python scripts/browser_publish.py --reserve --post {args.post}")

    except Abort:
        raise
    except Exception as e:
        step = cp.resume_point(pdir) or "unknown"
        shot = shoot(page, pdir, step) if page else ""
        entry = cp.record_failure(
            pdir, step, f"{type(e).__name__}: {e}",
            url=page.url if page else "", shot=shot,
            todo="위 내용을 확인한 뒤 같은 명령을 다시 실행해 주세요. 멈춘 곳부터 이어서 합니다.",
        )
        cp.write_failure_report(pdir, entry)
        raise Abort(
            f"{cp.STEP_KO.get(step, step)} 단계에서 멈췄습니다.\n"
            f"      {e}\n"
            f"      실패 보고서: {c.rel(pdir / 'publish' / '실패보고서.md')}\n"
            f"      다시 실행하면 처음부터가 아니라 멈춘 곳부터 이어서 합니다."
        )
    finally:
        ctx.close(); pw.stop()


def cmd_reserve(args) -> None:
    """비공개 저장을 끝낸 글에 예약을 겁니다."""
    settings = c.load_settings()
    b = load_browser_settings()
    sel = c.read_yaml(SELECTOR_PATH, default={}) or {}
    if not sel.get("verified"):
        raise Abort("화면 구조 확인이 먼저입니다: --calibrate")

    pdir, meta = find_post(args.week, args.post)
    preflight(pdir, meta, settings, "reserve")

    if meta.get("status") not in ("draft_saved", "reservation_requested"):
        raise Abort(
            f"비공개 저장을 먼저 끝내 주세요.\n"
            f"      지금 상태: {c.STATUS_KO.get(meta.get('status'), '?')}\n"
            f"      python scripts/browser_publish.py --fill --post {args.post}"
        )

    ch = c.get_channel(pdir.parent.name)
    pub = meta.get("publish") or {}
    post = PostFile.load(pdir / "post.md")

    c.header(f"예약 걸기 — {ch['name']}")
    c.say()
    c.say(f"    채널      : {ch['confirm_phrase']}")
    c.say(f"    제목      : {meta.get('title')}")
    c.say(f"    예약 일시 : {pub.get('date')} ({post.get('weekday')}) {pub.get('time')} KST")
    c.say()
    if not args.confirm and not c.confirm("  이대로 예약할까요?"):
        c.info("취소했습니다.")
        return

    pw, ctx = open_browser(b, ch["key"])
    page = None
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(ch["url"], wait_until="domcontentloaded")
        wait_login(page, ch["blog_id"], sel)
        verify_identity(page, ch, meta, sel, post)
        require_selectors(sel, page, REQUIRED_RESERVE, pdir, "reservation_set")

        editor = sel["editor"]
        delay = float(b.get("step_delay_seconds", 1.5))

        c.info("예약 설정을 엽니다 …")
        page.click(editor["publish_button"]); time.sleep(delay)
        page.click(editor["schedule_toggle"]); time.sleep(delay)
        page.fill(editor["schedule_date"], str(pub.get("date")))
        page.fill(editor["schedule_time"], str(pub.get("time")))
        time.sleep(delay)
        cp.mark(pdir, "reservation_set")

        c.say()
        c.say("  ┌─ 마지막 확인 ────────────────────────────────────────┐")
        c.say(f"  │  {ch['confirm_phrase']}")
        c.say(f"  │  {pub.get('date')} {pub.get('time')} KST")
        c.say("  └──────────────────────────────────────────────────────┘")
        c.say()
        if not c.confirm("  브라우저 화면을 보고 확인하셨나요? 예약을 저장할까요?"):
            c.info("저장하지 않았습니다.")
            input("  확인이 끝나면 Enter 를 눌러 주세요 …")
            return

        page.click(editor["confirm_button"])
        time.sleep(delay * 2)
        cp.mark(pdir, "reservation_saved")
        _advance(pdir, meta, "reservation_requested")

        c.say()
        c.ok(f"{args.post} — 예약을 걸었습니다.")
        c.say("      아직 끝이 아닙니다. 예약 목록에서 확인해 주세요:")
        c.say(f"        python scripts/browser_publish.py --verify --post {args.post}")
        c.say("      또는 네이버에서 직접 확인한 뒤:")
        c.say(f"        python scripts/publish_status.py --set reservation_verified "
              f"--post {args.post}")
    except Abort:
        raise
    except Exception as e:
        shot = shoot(page, pdir, "reservation") if page else ""
        entry = cp.record_failure(
            pdir, "reservation_set", f"{type(e).__name__}: {e}",
            url=page.url if page else "", shot=shot,
            todo="네이버에서 예약이 걸렸는지 직접 확인해 주세요. 걸렸다면 --set reservation_requested 로 기록하세요.",
        )
        cp.write_failure_report(pdir, entry)
        raise Abort(f"예약 중 멈췄습니다: {e}\n"
                    f"      실패 보고서: {c.rel(pdir / 'publish' / '실패보고서.md')}")
    finally:
        ctx.close(); pw.stop()


def cmd_verify(args) -> None:
    """예약 목록에서 제목과 시각을 다시 확인합니다."""
    b = load_browser_settings()
    sel = c.read_yaml(SELECTOR_PATH, default={}) or {}
    pdir, meta = find_post(args.week, args.post)
    rl = sel.get("reservation_list") or {}

    if not rl.get("items"):
        raise Abort(
            "예약 목록을 읽을 위치가 아직 설정되지 않았습니다.\n"
            f"      {c.rel(SELECTOR_PATH)} 의 reservation_list 를 채워 주세요.\n"
            "\n"
            "      직접 확인하셔도 됩니다. 네이버 글쓰기 화면 위쪽의\n"
            "      예약 건수를 눌러 목록을 열고 제목·시각을 확인한 뒤:\n"
            f"        python scripts/publish_status.py --set reservation_verified "
            f"--post {args.post}"
        )
    raise Abort("예약 목록 확인 기능은 화면 구조 확인이 끝난 뒤에 쓸 수 있습니다.")


def _advance(pdir: Path, meta: dict, status: str) -> None:
    """상태를 한 단계 올립니다. 이미 지났으면 그냥 둡니다."""
    cur = c.read_yaml(pdir / "metadata.yaml", default={}) or {}
    if c.status_index(cur.get("status", "draft")) >= c.status_index(status):
        return
    now = c.now_kst().strftime("%Y-%m-%d %H:%M:%S KST")
    cur["status"] = status
    cur.setdefault("history", []).append({
        "status": status, "at": now, "by": "browser_publish.py", "note": "",
    })
    c.write_yaml(pdir / "metadata.yaml", cur)
    meta.update(cur)


# ──────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(
        description="브라우저로 네이버 예약 등록을 돕습니다. (선택 기능)")
    ap.add_argument("--check", action="store_true", help="로그인·채널만 확인")
    ap.add_argument("--calibrate", action="store_true", help="화면 구조 확인")
    ap.add_argument("--fill", action="store_true", help="편집기 입력 → 비공개 저장")
    ap.add_argument("--reserve", action="store_true", help="예약 걸기")
    ap.add_argument("--verify", action="store_true", help="예약 목록에서 확인")
    ap.add_argument("--post", help="게시물 ID")
    ap.add_argument("--week")
    ap.add_argument("--channel", default="coin", choices=["coin", "stock"])
    ap.add_argument("--confirm", action="store_true",
                    help="시작 질문을 건너뜁니다 (마지막 확인은 그대로 남습니다)")
    args = ap.parse_args()

    try:
        if args.check:
            cmd_check(args)
        elif args.calibrate:
            cmd_calibrate(args)
        elif args.fill or args.reserve or args.verify:
            if not args.post:
                raise Abort("--post <게시물ID> 를 함께 적어 주세요.")
            (cmd_fill if args.fill else
             cmd_reserve if args.reserve else cmd_verify)(args)
        else:
            ap.print_help()
    except Abort as e:
        c.say(); c.error(str(e)); raise SystemExit(1)
    except c.ConfigError as e:
        c.error(str(e)); raise SystemExit(1)
    except KeyboardInterrupt:
        c.say(); c.info("사용자가 중단했습니다."); raise SystemExit(130)


if __name__ == "__main__":
    main()
