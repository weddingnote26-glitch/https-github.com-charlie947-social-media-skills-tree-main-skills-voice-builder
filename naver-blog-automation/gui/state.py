# -*- coding: utf-8 -*-
"""
지금 프로젝트가 어떤 상태인지 읽고, 화면에서 바꾼 것을 안전하게 적습니다.

정확성이 최우선입니다.
  · 상태 이름은 scripts/common.py 의 것과 똑같이 씁니다.
  · 네이버에서 확인하지 않은 것을 '예약됨'·'발행됨'으로 보여 주지 않습니다.
"""
from __future__ import annotations

import datetime as _dt
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

# 프로젝트 폴더 판단은 runner 와 같은 규칙을 씁니다.
from .runner import PROJECT_ROOT  # noqa: E402

KST = _dt.timezone(_dt.timedelta(hours=9), "KST")


def now_kst() -> _dt.datetime:
    return _dt.datetime.now(KST)


# ══════════════════════════════════════════════════════════════
# 상태 이름 — scripts/common.py 의 STATUSES / STATUS_KO 와 같은 내용입니다.
# (묶인 실행파일에서는 scripts 를 못 읽을 수 있어 여기에도 둡니다.
#  고칠 때는 두 곳을 함께 고쳐 주세요)
# ══════════════════════════════════════════════════════════════
STATUSES = [
    "draft", "fact_checked", "reviewed", "approved",
    "editor_filled", "draft_saved",
    "reservation_requested", "reservation_verified",
    "published", "post_publish_verified",
]
STATUS_KO = {
    "draft":                 "원고 작성됨",
    "fact_checked":          "사실확인 완료",
    "reviewed":              "검수 통과",
    "approved":              "승인됨",
    "editor_filled":         "편집기 입력됨",
    "draft_saved":           "비공개 저장됨",
    "reservation_requested": "예약 요청됨 — 네이버 확인 필요",
    "reservation_verified":  "예약 확인됨",
    "published":             "발행됨 — 확인 필요",
    "post_publish_verified": "발행 확인 완료",
    "failed":                "실패 — 사람 확인 필요",
}

# 발행 관리 화면의 네 칸
WAITING = ("approved", "editor_filled", "draft_saved")        # 발행 대기
NEED_CHECK = ("reservation_requested", "published")           # 확인 필요
RESERVED = ("reservation_verified",)                          # 예약됨
WRITING = ("draft", "fact_checked", "reviewed")               # 아직 글 관리 단계

# 예약 버튼이 실제로 부르는 프로그램 — schedule_week.py 가 아닙니다.
RESERVE_SCRIPT = "browser_publish.py"


def status_ko(raw: str) -> str:
    """영어 상태값을 화면용 한국어로. 모르는 값은 그대로 두지 않고 표시합니다."""
    if not raw:
        return "원고 없음"
    return STATUS_KO.get(raw, f"알 수 없는 상태({raw})")


def status_index(s: str) -> int:
    try:
        return STATUSES.index(s)
    except ValueError:
        return -1


def _yaml(path: Path) -> dict:
    try:
        import yaml
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001 - 화면이 죽지 않는 것이 우선입니다
        return {}


def _yaml_write(path: Path, data: dict) -> None:
    import yaml
    path.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False),
        encoding="utf-8")


FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)


def front_matter(path: Path) -> dict:
    """post.md 맨 위의 --- 사이를 읽습니다. (이미지 목록이 여기 있습니다)"""
    if not path.exists():
        return {}
    try:
        import yaml
        m = FM_RE.match(path.read_text(encoding="utf-8"))
        return (yaml.safe_load(m.group(1)) or {}) if m else {}
    except Exception:  # noqa: BLE001
        return {}


def split_post(path: Path) -> tuple[str, str]:
    """post.md 를 (앞머리 원문, 본문) 두 조각으로 나눕니다. 글자 그대로."""
    text = path.read_text(encoding="utf-8")
    m = FM_RE.match(text)
    if not m:
        return "", text
    return m.group(1), text[m.end():]


# ══════════════════════════════════════════════════════════════
@dataclass
class PostState:
    channel: str
    channel_name: str
    date: str
    post_id: str = ""
    slot: str = ""
    title: str = ""
    raw_status: str = ""            # 영어 상태값 (없으면 빈 문자열 = 원고 없음)
    publish_time: str = ""
    weekday: str = ""
    visibility: str = ""
    url: str = ""                   # 네이버 글 주소 (확인된 것만)
    fail_note: str = ""
    images_need: int = 0
    images_have: int = 0
    review_passed: bool = False
    folder: Path = field(default_factory=Path)

    @property
    def status(self) -> str:
        """화면용 한국어 상태."""
        if not self.has_draft:
            return "원고 없음"
        return status_ko(self.raw_status or "draft")

    @property
    def has_draft(self) -> bool:
        return (self.folder / "post.md").exists()

    @property
    def images_done(self) -> bool:
        return self.images_need == 0 or self.images_have >= self.images_need

    @property
    def can_reserve(self) -> bool:
        """예약을 걸 수 있는 단계인가. (승인됨 이상, 아직 요청 전)"""
        return self.raw_status in WAITING

    @property
    def problem(self) -> str:
        """이미지·검수에서 걸리는 것이 있으면 한 줄로."""
        probs = []
        if self.has_draft and not self.review_passed:
            probs.append("검수 미통과")
        if not self.images_done:
            probs.append(f"이미지 {self.images_have}/{self.images_need}")
        if self.raw_status == "failed":
            probs.append("실패")
        return " · ".join(probs)


def latest_week() -> str | None:
    out = PROJECT_ROOT / "output"
    if not out.exists():
        return None
    weeks = sorted(p.name for p in out.iterdir() if p.is_dir() and p.name.startswith("20"))
    return weeks[-1] if weeks else None


def channel_name(key: str) -> str:
    ch = _yaml(PROJECT_ROOT / "config" / "channel_profiles.yaml").get("channels") or {}
    return (ch.get(key) or {}).get("name", key)


def posts(week: str | None = None, root: Path | None = None) -> list[PostState]:
    root = root or PROJECT_ROOT
    if week is None:
        out = root / "output"
        weeks = sorted(p.name for p in out.iterdir()
                       if p.is_dir() and p.name.startswith("20")) if out.exists() else []
        week = weeks[-1] if weeks else None
    if not week:
        return []
    wdir = root / "output" / week
    if not wdir.exists():
        return []

    out: list[PostState] = []
    for chdir in sorted(p for p in wdir.iterdir() if p.is_dir()):
        cname = channel_name(chdir.name) if root == PROJECT_ROOT else chdir.name
        for d in sorted(p for p in chdir.iterdir() if p.is_dir()):
            meta = _yaml(d / "metadata.yaml")
            fm = front_matter(d / "post.md")
            pub = meta.get("publish") or {}
            st = PostState(
                channel=chdir.name,
                channel_name=cname,
                date=str(pub.get("date") or d.name),
                post_id=str(meta.get("post_id") or d.name),
                slot=str(meta.get("slot") or ""),
                title=str(meta.get("title") or ""),
                raw_status=str(meta.get("status") or ""),
                publish_time=str(pub.get("time") or ""),
                weekday=str(pub.get("weekday") or ""),
                visibility=str(pub.get("visibility") or ""),
                url=str((meta.get("published") or {}).get("post_url") or ""),
                fail_note=str((meta.get("failure") or {}).get("note") or ""),
                folder=d,
            )
            st.review_passed = bool((meta.get("review") or {}).get("passed"))
            if st.has_draft and not st.raw_status:
                st.raw_status = "draft"

            # 이미지 목록은 원고(post.md) 앞머리에 있습니다.
            imgs = [i for i in (fm.get("images") or []) if isinstance(i, dict)]
            st.images_need = len(imgs)
            idir = d / "images"
            if idir.exists():
                st.images_have = sum(
                    1 for i in imgs if (idir / str(i.get("file", ""))).exists())
            out.append(st)
    return out


# ══════════════════════════════════════════════════════════════
# 오늘 할 일
# ══════════════════════════════════════════════════════════════
def today_scheduled(all_posts: list[PostState] | None = None) -> list[PostState]:
    """
    오늘 예약된 글 — **네이버 예약 목록에서 확인이 끝난 글만** 셉니다.

    날짜만 오늘인 글을 '예약됨'으로 보여 주면
    실제로는 아무것도 걸려 있지 않은데 예약된 줄 알게 됩니다.
    """
    today = now_kst().strftime("%Y-%m-%d")
    rows = all_posts if all_posts is not None else posts()
    return [p for p in rows if p.date == today and p.raw_status in RESERVED]


def today_to_publish(all_posts: list[PostState] | None = None) -> list[PostState]:
    """오늘 직접 올릴 글 — 승인됐지만 아직 예약·발행 전인 것."""
    today = now_kst().strftime("%Y-%m-%d")
    rows = all_posts if all_posts is not None else posts()
    return [p for p in rows if p.date == today and p.raw_status in WAITING]


def need_check(all_posts: list[PostState] | None = None) -> list[PostState]:
    """네이버에서 확인이 필요한 글 — 요청만 했거나, 발행 확인 전."""
    rows = all_posts if all_posts is not None else posts()
    return [p for p in rows if p.raw_status in NEED_CHECK]


def with_problems(all_posts: list[PostState] | None = None) -> list[PostState]:
    rows = all_posts if all_posts is not None else posts()
    return [p for p in rows if p.problem]


def next_action(all_posts: list[PostState]) -> tuple[str, str]:
    """
    (안내 문구, 이동할 화면 이름) — 지금 가장 먼저 할 일 하나.
    """
    for p in all_posts:
        if p.raw_status == "failed":
            return (f"실패한 글이 있습니다 — {p.channel_name} {p.date}\n"
                    f"사유: {p.fail_note or '기록 없음'}", "발행 관리")
    chk = need_check(all_posts)
    if chk:
        p = chk[0]
        return (f"네이버에서 확인할 글이 있습니다 — {p.channel_name} {p.date}\n"
                f"({p.status})", "발행 관리")
    direct = today_to_publish(all_posts)
    if direct:
        p = direct[0]
        return (f"오늘 올릴 글이 준비되어 있습니다 — {p.channel_name}\n"
                f"{p.title or p.slot}", "발행 관리")
    prob = with_problems(all_posts)
    if prob:
        p = prob[0]
        return (f"손볼 글이 있습니다 — {p.channel_name} {p.date}\n({p.problem})", "글 관리")
    drafts = [p for p in all_posts if not p.has_draft]
    if drafts:
        return (f"원고가 없는 글이 {len(drafts)}편 있습니다.", "글 관리")
    return ("이번 주 글은 모두 준비됐습니다.\n다음 주 원고를 미리 만들어 두셔도 좋습니다.",
            "글 관리")


# ══════════════════════════════════════════════════════════════
@dataclass
class Health:
    week: str = "-"
    total: int = 0
    drafted: int = 0
    reviewed: int = 0
    approved: int = 0
    images_need: int = 0
    images_have: int = 0
    naver_linked: bool = False
    browser_enabled: bool = False
    style_coin: str = "-"
    style_stock: str = "-"
    sources_checked: str = "-"
    sources_missing: int = 0


def _style(key: str) -> str:
    p = PROJECT_ROOT / "config" / f"style_{key}.md"
    if not p.exists():
        return "없음"
    m = re.search(r"^sample_count:\s*(\d+)", p.read_text(encoding="utf-8"), re.M)
    return f"샘플 {m.group(1)}편" if m else "분석됨"


def settings() -> dict:
    return _yaml(PROJECT_ROOT / "config" / "settings.yaml")


def health() -> Health:
    h = Health(week=latest_week() or "-")
    for p in posts():
        h.total += 1
        if p.has_draft:
            h.drafted += 1
        if p.review_passed:
            h.reviewed += 1
        if status_index(p.raw_status) >= status_index("approved"):
            h.approved += 1
        h.images_need += p.images_need
        h.images_have += p.images_have

    prof = PROJECT_ROOT / "private" / "browser-profile"
    h.naver_linked = prof.exists() and any(prof.iterdir()) if prof.exists() else False
    h.browser_enabled = bool((settings().get("browser") or {}).get("enabled"))
    h.style_coin = _style("coin")
    h.style_stock = _style("stock")

    src = PROJECT_ROOT / "sources.md"
    if src.exists():
        t = src.read_text(encoding="utf-8")
        h.sources_missing = len(re.findall(r"\|\s*확인 필요\s*\|", t))
        m = re.findall(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) KST", t)
        h.sources_checked = max(m) + " KST" if m else "-"
    return h


# ══════════════════════════════════════════════════════════════
# 예약 전 검사 — 화면이 미리 걸러 줍니다
# ══════════════════════════════════════════════════════════════
def reserve_check(post: PostState, when: _dt.datetime,
                  all_posts: list[PostState] | None = None,
                  conf: dict | None = None) -> list[str]:
    """
    이 글을 이 시각에 예약해도 되는지 검사합니다.

    돌려주는 값: 문제 목록 (비어 있으면 통과).
    """
    conf = conf if conf is not None else settings()
    rows = all_posts if all_posts is not None else posts()
    sch = conf.get("schedule") or {}
    problems: list[str] = []

    if not (conf.get("browser") or {}).get("enabled"):
        problems.append("브라우저 예약 등록이 꺼져 있습니다. (설정에서 켜 주세요)")
    if not post.can_reserve:
        problems.append(f"이 글은 지금 '{post.status}' 상태라 예약할 수 없습니다. "
                        "(승인까지 끝난 글만 예약할 수 있습니다)")
    if not post.images_done:
        problems.append(f"이미지가 아직 {post.images_have}/{post.images_need}장입니다.")

    if when.tzinfo is None:
        when = when.replace(tzinfo=KST)
    # 예약은 분 단위입니다. 초까지 비교하면 같은 시각을 놓칩니다.
    when = when.replace(second=0, microsecond=0)
    lead_h = float(sch.get("min_lead_hours") or 0)
    if when <= now_kst():
        problems.append("예약 시각이 이미 지났습니다.")
    elif when < now_kst() + _dt.timedelta(hours=lead_h):
        problems.append(f"예약은 지금부터 최소 {lead_h:g}시간 뒤여야 합니다.")

    gap_h = float(sch.get("min_gap_hours") or 0)
    for other in rows:
        if other.folder == post.folder:
            continue
        if other.raw_status not in RESERVED + ("reservation_requested",):
            continue
        try:
            odt = _dt.datetime.strptime(
                f"{other.date} {other.publish_time}", "%Y-%m-%d %H:%M"
            ).replace(tzinfo=KST)
        except ValueError:
            continue
        if odt == when:
            problems.append(f"같은 시각에 이미 예약된 글이 있습니다: "
                            f"{other.channel_name} {other.date} {other.publish_time}")
        elif other.channel == post.channel and abs((odt - when).total_seconds()) < gap_h * 3600:
            problems.append(f"같은 채널의 다른 예약과 {gap_h:g}시간 이상 띄워 주세요. "
                            f"({other.date} {other.publish_time} 예약과 너무 가깝습니다)")
    return problems


def set_publish_time(post: PostState, hhmm: str) -> None:
    """metadata.yaml 의 예약 시각만 바꿉니다."""
    mp = post.folder / "metadata.yaml"
    meta = _yaml(mp)
    meta.setdefault("publish", {})["time"] = hhmm
    _yaml_write(mp, meta)


# ══════════════════════════════════════════════════════════════
# 원고 저장 — 파일 형식을 훼손하지 않습니다
# ══════════════════════════════════════════════════════════════
def save_post(folder: Path, title: str, body: str) -> tuple[bool, str]:
    """
    제목과 본문을 저장합니다.

    앞머리(---)는 제목 줄 **한 줄만** 글자 단위로 바꿉니다.
    다른 줄은 그대로 두므로 이미지 목록·infographic 칸이 깨지지 않습니다.
    저장 전에 이전 내용을 .bak 으로 남깁니다.
    """
    p = folder / "post.md"
    if not p.exists():
        return False, "원고 파일(post.md)이 없습니다."
    fm, _old_body = split_post(p)
    if not fm:
        return False, "원고 앞머리(---)를 찾지 못했습니다. 파일을 직접 확인해 주세요."

    safe_title = title.replace("'", "''")
    new_fm, n = re.subn(r"(?m)^title:.*$", f"title: '{safe_title}'", fm, count=1)
    if n == 0:
        new_fm = f"title: '{safe_title}'\n" + fm

    if not body.endswith("\n"):
        body += "\n"
    shutil.copy2(p, p.with_suffix(".md.bak"))
    p.write_text(f"---\n{new_fm}\n---\n{body}", encoding="utf-8")

    # 제목은 metadata.yaml 에도 있습니다. 같이 맞춰 줍니다.
    mp = folder / "metadata.yaml"
    if mp.exists():
        meta = _yaml(mp)
        if meta.get("title") != title:
            meta["title"] = title
            _yaml_write(mp, meta)
    return True, ""


def save_image_order(folder: Path, files_in_order: list[str]) -> tuple[bool, str]:
    """
    이미지 순서를 원고 앞머리의 images 목록에 적습니다.

    앞머리 전체를 다시 쓰지 않고 images 항목만 다시 만듭니다.
    """
    import yaml
    p = folder / "post.md"
    if not p.exists():
        return False, "원고 파일(post.md)이 없습니다."
    fm_text, body = split_post(p)
    fm = front_matter(p)
    imgs = [i for i in (fm.get("images") or []) if isinstance(i, dict)]
    if not imgs:
        return False, "이 글에는 이미지 목록이 없습니다."
    by_file = {str(i.get("file", "")): i for i in imgs}
    if set(files_in_order) != set(by_file):
        return False, "이미지 목록이 파일과 맞지 않습니다. 화면을 새로 고쳐 주세요."

    new_imgs = [by_file[f] for f in files_in_order]
    dumped = yaml.safe_dump({"images": new_imgs}, allow_unicode=True,
                            sort_keys=False).rstrip("\n")
    # 항목 줄은 '- file:' 처럼 붙임표로 시작하고, 이어지는 줄은 들여쓰기입니다.
    new_fm, n = re.subn(
        r"(?ms)^images:\n(?:(?:[ \t]+.*|-[ \t].*)\n?)*",
        dumped + "\n", fm_text + "\n", count=1)
    if n == 0:
        return False, "앞머리에서 images 칸을 찾지 못했습니다."
    shutil.copy2(p, p.with_suffix(".md.bak"))
    p.write_text(f"---\n{new_fm.rstrip()}\n---\n{body}", encoding="utf-8")
    return True, ""


# ══════════════════════════════════════════════════════════════
# 설정 저장 — 주석을 지키면서 값만 바꿉니다
# ══════════════════════════════════════════════════════════════
# 각 항목을 찾는 정규식 — settings.yaml 의 실제 줄 모양에 맞춰져 있습니다.
_SETTING_PATTERNS = {
    "coin_time":    r"(?m)^(\s{2}coin:\s*\")\d{2}:\d{2}(\")",
    "stock_time":   r"(?m)^(\s{2}stock:\s*\")\d{2}:\d{2}(\")",
    "holiday":      r"(?m)^(\s{2}publish_on_holiday:\s*)(?:true|false)",
    "gap_hours":    r"(?m)^(\s{2}min_gap_hours:\s*)\d+",
    "lead_hours":   r"(?m)^(\s{2}min_lead_hours:\s*)\d+",
    "browser_on":   r"(?m)^(\s{2}enabled:\s*)(?:true|false)",
    "account_mode": r"(?m)^(\s{2}account_mode:\s*)\S+",
    "max_posts":    r"(?m)^(\s{2}max_posts_per_run:\s*)\d+",
}


def validate_settings(vals: dict) -> list[str]:
    """저장 전에 값이 말이 되는지 검사합니다."""
    probs = []
    for k in ("coin_time", "stock_time"):
        v = str(vals.get(k, ""))
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
            probs.append(f"발행 시각이 올바르지 않습니다: {v}")
    if not 0 <= int(vals.get("gap_hours", 0)) <= 48:
        probs.append("같은 채널 최소 간격은 0~48시간이어야 합니다.")
    if not 0 <= int(vals.get("lead_hours", 0)) <= 48:
        probs.append("최소 준비 시간은 0~48시간이어야 합니다.")
    if not 1 <= int(vals.get("max_posts", 1)) <= 3:
        probs.append("한 번에 등록할 글 수는 1~3편이어야 합니다.")
    if vals.get("account_mode") not in ("same_account", "separate_accounts"):
        probs.append("계정 방식 값이 올바르지 않습니다.")
    return probs


def save_settings(vals: dict, path: Path | None = None) -> tuple[bool, str]:
    """
    settings.yaml 의 알려진 값만 바꿔 저장합니다.

    파일 전체를 다시 쓰지 않으므로 설명(주석)이 그대로 남습니다.
    저장 전 검사에 걸리면 아무것도 바꾸지 않습니다.
    """
    import yaml
    path = path or (PROJECT_ROOT / "config" / "settings.yaml")
    if not path.exists():
        return False, "설정 파일이 없습니다. 프로그램을 한 번 실행하면 만들어집니다."
    probs = validate_settings(vals)
    if probs:
        return False, "\n".join(probs)

    text = path.read_text(encoding="utf-8")
    replacements = {
        "coin_time":    rf"\g<1>{vals['coin_time']}\g<2>",
        "stock_time":   rf"\g<1>{vals['stock_time']}\g<2>",
        "holiday":      rf"\g<1>{'true' if vals['holiday'] else 'false'}",
        "gap_hours":    rf"\g<1>{int(vals['gap_hours'])}",
        "lead_hours":   rf"\g<1>{int(vals['lead_hours'])}",
        "browser_on":   rf"\g<1>{'true' if vals['browser_on'] else 'false'}",
        "account_mode": rf"\g<1>{vals['account_mode']}",
        "max_posts":    rf"\g<1>{int(vals['max_posts'])}",
    }
    missing = []
    for key, pat in _SETTING_PATTERNS.items():
        text, n = re.subn(pat, replacements[key], text, count=1)
        if n == 0:
            missing.append(key)
    if missing:
        return False, ("설정 파일에서 다음 줄을 찾지 못해 저장하지 않았습니다:\n  "
                       + ", ".join(missing)
                       + "\n'설정 파일 직접 열기'로 확인해 주세요.")
    try:
        yaml.safe_load(text)
    except yaml.YAMLError as e:
        return False, f"저장하면 설정 파일이 깨져서 멈췄습니다.\n{e}"

    shutil.copy2(path, path.with_suffix(".yaml.bak"))
    path.write_text(text, encoding="utf-8")
    return True, ""


def read_settings_form() -> dict:
    """설정 화면 폼에 채울 현재 값."""
    s = settings()
    times = s.get("publish_times") or {}
    sch = s.get("schedule") or {}
    br = s.get("browser") or {}
    return {
        "coin_time": str(times.get("coin") or "08:30"),
        "stock_time": str(times.get("stock") or "07:30"),
        "holiday": bool((s.get("holidays") or {}).get("publish_on_holiday", True)),
        "gap_hours": int(sch.get("min_gap_hours") or 12),
        "lead_hours": int(sch.get("min_lead_hours") or 1),
        "browser_on": bool(br.get("enabled")),
        "account_mode": str(br.get("account_mode") or "same_account"),
        "max_posts": int(br.get("max_posts_per_run") or 1),
    }


def docs() -> list[tuple[str, Path]]:
    """도움말 화면에 띄울 문서들."""
    names = [
        ("처음 설치하기", "회사PC_처음설치.md"),
        ("평소 쓰는 법", "회사PC_실행방법.md"),
        ("문제가 생겼을 때", "회사PC_문제해결.md"),
        ("이미지 만드는 법 (챗GPT)", "이미지_챗GPT_만드는법.md"),
        ("정리 그림 만드는 법", "인포그래픽_만드는법.md"),
        ("전체 설명서", "README.md"),
    ]
    return [(t, PROJECT_ROOT / f) for t, f in names if (PROJECT_ROOT / f).exists()]
