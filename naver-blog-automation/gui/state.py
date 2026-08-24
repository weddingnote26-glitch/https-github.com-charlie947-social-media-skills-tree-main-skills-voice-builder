# -*- coding: utf-8 -*-
"""
지금 프로젝트가 어떤 상태인지 읽어 옵니다. (읽기만 합니다)

화면에 보여 줄 값만 모읍니다. 파일을 고치지 않습니다.
"""
from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field
from pathlib import Path

# 프로젝트 폴더 판단은 runner 와 같은 규칙을 씁니다.
from .runner import PROJECT_ROOT  # noqa: E402

KST = _dt.timezone(_dt.timedelta(hours=9), "KST")


def now_kst() -> _dt.datetime:
    return _dt.datetime.now(KST)


def _yaml(path: Path) -> dict:
    try:
        import yaml
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001 - 화면이 죽지 않는 것이 우선입니다
        return {}


def front_matter(path: Path) -> dict:
    """
    post.md 맨 위의 --- 사이를 읽습니다.

    이미지 목록은 metadata.yaml 이 아니라 **원고(post.md) 앞머리**에 있습니다.
    """
    if not path.exists():
        return {}
    try:
        import yaml
        text = path.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
        return (yaml.safe_load(m.group(1)) or {}) if m else {}
    except Exception:  # noqa: BLE001
        return {}


@dataclass
class PostState:
    channel: str
    channel_name: str
    date: str
    slot: str = ""
    title: str = ""
    status: str = "지시서만"
    images_need: int = 0
    images_have: int = 0
    review_passed: bool = False
    folder: Path = field(default_factory=Path)

    @property
    def has_draft(self) -> bool:
        return (self.folder / "post.md").exists()

    @property
    def images_done(self) -> bool:
        return self.images_need == 0 or self.images_have >= self.images_need


STATUS_KO = {
    "draft": "원고 작성됨",
    "reviewed": "검수 통과",
    "approved": "승인됨",
    "scheduled": "예약 등록됨",
    "published": "발행됨",
}


def latest_week() -> str | None:
    out = PROJECT_ROOT / "output"
    if not out.exists():
        return None
    weeks = sorted(p.name for p in out.iterdir() if p.is_dir() and p.name.startswith("20"))
    return weeks[-1] if weeks else None


def channel_name(key: str) -> str:
    ch = _yaml(PROJECT_ROOT / "config" / "channel_profiles.yaml").get("channels") or {}
    return (ch.get(key) or {}).get("name", key)


def posts(week: str | None = None) -> list[PostState]:
    week = week or latest_week()
    if not week:
        return []
    wdir = PROJECT_ROOT / "output" / week
    if not wdir.exists():
        return []

    out: list[PostState] = []
    for chdir in sorted(p for p in wdir.iterdir() if p.is_dir()):
        cname = channel_name(chdir.name)
        for d in sorted(p for p in chdir.iterdir() if p.is_dir()):
            meta = _yaml(d / "metadata.yaml")
            fm = front_matter(d / "post.md")
            st = PostState(
                channel=chdir.name,
                channel_name=cname,
                date=d.name,
                slot=str(meta.get("slot") or ""),
                title=str(meta.get("title") or ""),
                folder=d,
            )

            # 상태 — 승인·예약·발행이 우선이고, 그다음이 검수 통과입니다.
            raw = str(meta.get("status") or "")
            passed = bool((meta.get("review") or {}).get("passed"))
            if not (d / "post.md").exists():
                st.status = "지시서만"
            elif raw in ("approved", "scheduled", "published"):
                st.status = STATUS_KO[raw]
            elif passed:
                st.status = "검수 통과"
            else:
                st.status = STATUS_KO.get(raw, raw or "원고 작성됨")
            st.review_passed = passed

            # 이미지 목록은 원고(post.md) 앞머리에 있습니다.
            imgs = [i for i in (fm.get("images") or []) if isinstance(i, dict)]
            st.images_need = len(imgs)
            idir = d / "images"
            if idir.exists():
                st.images_have = sum(
                    1 for i in imgs if (idir / str(i.get("file", ""))).exists()
                )
            out.append(st)
    return out


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


def health() -> Health:
    h = Health(week=latest_week() or "-")
    for p in posts():
        h.total += 1
        if p.has_draft:
            h.drafted += 1
        if p.review_passed:
            h.reviewed += 1
        if p.status in ("승인됨", "예약 등록됨", "발행됨"):
            h.approved += 1
        h.images_need += p.images_need
        h.images_have += p.images_have

    prof = PROJECT_ROOT / "private" / "browser-profile"
    h.naver_linked = prof.exists() and any(prof.iterdir()) if prof.exists() else False
    h.browser_enabled = bool(
        (_yaml(PROJECT_ROOT / "config" / "settings.yaml").get("browser") or {}).get("enabled")
    )
    h.style_coin = _style("coin")
    h.style_stock = _style("stock")

    src = PROJECT_ROOT / "sources.md"
    if src.exists():
        t = src.read_text(encoding="utf-8")
        h.sources_missing = len(re.findall(r"\|\s*확인 필요\s*\|", t))
        m = re.findall(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) KST", t)
        h.sources_checked = max(m) + " KST" if m else "-"
    return h


def today_scheduled() -> list[PostState]:
    today = now_kst().strftime("%Y-%m-%d")
    return [p for p in posts() if p.date == today]


def docs() -> list[tuple[str, Path]]:
    """도움말 화면에 띄울 문서들."""
    names = [
        ("처음 설치하기", "회사PC_처음설치.md"),
        ("평소 쓰는 법", "회사PC_실행방법.md"),
        ("문제가 생겼을 때", "회사PC_문제해결.md"),
        ("이미지 만드는 법 (챗GPT)", "이미지_챗GPT_만드는법.md"),
        ("전체 설명서", "README.md"),
    ]
    return [(t, PROJECT_ROOT / f) for t, f in names if (PROJECT_ROOT / f).exists()]
