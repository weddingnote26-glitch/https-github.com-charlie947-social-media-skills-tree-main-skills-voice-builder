# -*- coding: utf-8 -*-
"""
공통 모듈 — 경로, 설정, 로그, 인코딩을 한곳에서 처리합니다.

설계 원칙
  · 모든 경로는 '프로젝트 루트 기준 상대경로' 로 다룹니다.
  · Windows에서 폴더 이름에 한글이나 공백이 있어도 동작합니다.
  · 콘솔 출력은 항상 UTF-8 로 강제합니다. (Windows 기본 CP949 대응)
"""
from __future__ import annotations

import datetime as _dt
import io
import json
import locale
import logging
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

# ──────────────────────────────────────────────────────────────
# 0. 콘솔 인코딩 — Windows CP949 환경에서 한글이 깨지지 않게 합니다.
# ──────────────────────────────────────────────────────────────
def _force_utf8_console() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        try:
            # Python 3.7+ : 재설정 가능한 TextIOWrapper
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            try:
                buf = getattr(stream, "buffer", None)
                if buf is not None:
                    setattr(sys, stream_name,
                            io.TextIOWrapper(buf, encoding="utf-8", errors="replace"))
            except Exception:
                pass
    if os.name == "nt":
        # 콘솔 코드페이지를 UTF-8(65001)로 바꿔 둡니다. 실패해도 무시합니다.
        try:
            os.system("chcp 65001 > nul")
        except Exception:
            pass


_force_utf8_console()

# ──────────────────────────────────────────────────────────────
# 1. 경로
# ──────────────────────────────────────────────────────────────
#  scripts/common.py 의 부모의 부모 = 프로젝트 루트
PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent

CONFIG_DIR = PROJECT_ROOT / "config"
TEMPLATE_DIR = PROJECT_ROOT / "templates"
OUTPUT_DIR = PROJECT_ROOT / "output"
DATA_DIR = PROJECT_ROOT / "data"
CACHE_DIR = DATA_DIR / "source_cache"
PRIVATE_DIR = PROJECT_ROOT / "private"
LOG_DIR = PROJECT_ROOT / "logs"


# ──────────────────────────────────────────────────────────────
# 1-1. 클라우드 동기화 폴더 안에 있으면 경고합니다.
#
#  구글 드라이브·원드라이브·드롭박스는 .git 폴더의 작은 파일 수천 개를
#  순서를 지키지 않고 올립니다. 절반만 올라간 상태에서 다른 PC가 받으면
#  작업 기록이 깨집니다. 이 프로젝트는 깃허브로만 동기화합니다.
# ──────────────────────────────────────────────────────────────
CLOUD_MARKERS: list[tuple[str, str]] = [
    ("google drive", "구글 드라이브"),
    ("googledrive", "구글 드라이브"),
    ("내 드라이브", "구글 드라이브"),
    ("my drive", "구글 드라이브"),
    ("onedrive", "원드라이브"),
    ("dropbox", "드롭박스"),
    ("icloud", "아이클라우드"),
    ("naver mybox", "네이버 마이박스"),
]


def cloud_folder_name(path: Path | str | None = None) -> str | None:
    """
    이 폴더가 클라우드 동기화 폴더 안에 있으면 그 서비스 이름을 돌려줍니다.
    아니면 None 입니다.
    """
    target = Path(path) if path else PROJECT_ROOT
    try:
        parts = [seg.lower() for seg in target.resolve().parts]
    except OSError:
        parts = [seg.lower() for seg in target.parts]
    for seg in parts:
        for marker, korean in CLOUD_MARKERS:
            if marker in seg:
                return korean
    return None


def warn_if_cloud_synced(path: Path | str | None = None) -> bool:
    """클라우드 폴더 안이면 경고를 띄웁니다. 경고했으면 True."""
    name = cloud_folder_name(path)
    if not name:
        return False
    target = Path(path) if path else PROJECT_ROOT
    say()
    warn(f"이 폴더가 {name} 안에 있습니다.")
    say(f"      위치: {target}")
    say()
    say("      이대로 두면 작업 기록(.git)이 깨질 수 있습니다.")
    say(f"      {name}는 작은 파일 수천 개를 순서 없이 올립니다.")
    say("      절반만 올라간 상태에서 다른 PC가 받으면 기록이 망가집니다.")
    say()
    say("      이 프로젝트는 깃허브로만 동기화합니다.")
    say(f"      폴더를 {name} 밖으로 옮겨 주세요. (예: 내 문서\\블로그작업)")
    say()
    say("      문서·보고서는 클라우드에 두셔도 괜찮습니다.")
    say("      프로그램 폴더만 밖으로 옮기시면 됩니다.")
    say()
    return True


def rel(path: Path | str) -> str:
    """프로젝트 루트 기준 상대경로 문자열. 화면 표시·기록용."""
    p = Path(path)
    try:
        return p.resolve().relative_to(PROJECT_ROOT).as_posix()
    except (ValueError, OSError):
        return p.as_posix()


def ensure_dir(path: Path) -> Path:
    """폴더가 없으면 만들고 그 경로를 돌려줍니다."""
    path.mkdir(parents=True, exist_ok=True)
    return path


# ──────────────────────────────────────────────────────────────
# 2. 파일 읽기/쓰기 — 항상 UTF-8, 개행은 \n 으로 통일
# ──────────────────────────────────────────────────────────────
def read_text(path: Path | str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write_text(path: Path | str, content: str) -> Path:
    p = Path(path)
    ensure_dir(p.parent)
    # newline="\n" 로 Windows에서도 \r\n 이 섞이지 않게 합니다.
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    return p


def read_json(path: Path | str, default: Any = None) -> Any:
    p = Path(path)
    if not p.exists():
        return default
    try:
        return json.loads(read_text(p))
    except json.JSONDecodeError:
        return default


def write_json(path: Path | str, data: Any) -> Path:
    return write_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def read_yaml(path: Path | str, default: Any = None) -> Any:
    import yaml
    p = Path(path)
    if not p.exists():
        return default
    return yaml.safe_load(read_text(p))


def write_yaml(path: Path | str, data: Any) -> Path:
    import yaml
    text = yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=100)
    return write_text(path, text)


# ──────────────────────────────────────────────────────────────
# 3. 설정 불러오기
# ──────────────────────────────────────────────────────────────
class ConfigError(RuntimeError):
    """설정 파일이 없거나 잘못됐을 때."""


def load_settings() -> dict:
    """config/settings.yaml 을 읽습니다. 없으면 예시 파일로 안내합니다."""
    path = CONFIG_DIR / "settings.yaml"
    if not path.exists():
        example = CONFIG_DIR / "settings.example.yaml"
        if not example.exists():
            raise ConfigError(
                f"설정 파일이 없습니다: {rel(path)}\n"
                f"예시 파일도 찾을 수 없습니다."
            )
        raise ConfigError(
            f"개인 설정 파일이 아직 없습니다.\n"
            f"  {rel(example)} 를 복사해서\n"
            f"  {rel(path)} 로 저장한 뒤 다시 실행해 주세요.\n"
            f"  (setup.ps1 을 실행하면 자동으로 만들어 줍니다)"
        )
    data = read_yaml(path)
    if not isinstance(data, dict):
        raise ConfigError(f"설정 파일 형식이 잘못됐습니다: {rel(path)}")
    return data


def load_channels() -> dict:
    """config/channel_profiles.yaml 전체를 읽습니다."""
    path = CONFIG_DIR / "channel_profiles.yaml"
    data = read_yaml(path)
    if not isinstance(data, dict) or "channels" not in data:
        raise ConfigError(f"채널 설정을 읽을 수 없습니다: {rel(path)}")
    return data


def get_channel(key: str) -> dict:
    channels = load_channels()["channels"]
    if key not in channels:
        raise ConfigError(
            f"'{key}' 채널을 찾을 수 없습니다. 사용 가능: {', '.join(channels)}"
        )
    return channels[key]


def style_status(channel_key: str) -> dict:
    """
    style_*.md 의 앞머리(front matter)를 읽어 분석 완료 여부를 돌려줍니다.
    반환: {"status": "awaiting_samples"|"analyzed", "sample_count": int, ...}
    """
    ch = get_channel(channel_key)
    path = PROJECT_ROOT / ch.get("style_file", f"config/style_{channel_key}.md")
    if not path.exists():
        return {"status": "missing", "sample_count": 0, "path": rel(path)}
    text = read_text(path)
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not m:
        return {"status": "unknown", "sample_count": 0, "path": rel(path)}
    import yaml
    fm = yaml.safe_load(m.group(1)) or {}
    fm.setdefault("status", "unknown")
    fm.setdefault("sample_count", 0)
    fm["path"] = rel(path)
    return fm


# ──────────────────────────────────────────────────────────────
# 4. 날짜·주차
# ──────────────────────────────────────────────────────────────
KST = _dt.timezone(_dt.timedelta(hours=9), "KST")

WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WEEKDAY_KO = {
    "mon": "월", "tue": "화", "wed": "수",
    "thu": "목", "fri": "금", "sat": "토", "sun": "일",
}


def now_kst() -> _dt.datetime:
    return _dt.datetime.now(KST)


def week_id(any_date: _dt.date) -> str:
    """ISO 주차 문자열. 예: 2026-W35"""
    iso = any_date.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def monday_of(any_date: _dt.date) -> _dt.date:
    return any_date - _dt.timedelta(days=any_date.weekday())


def next_week_monday(from_date: _dt.date | None = None) -> _dt.date:
    base = from_date or now_kst().date()
    return monday_of(base) + _dt.timedelta(days=7)


def weekday_key(d: _dt.date) -> str:
    return WEEKDAY_KEYS[d.weekday()]


def weekday_ko(d: _dt.date) -> str:
    return WEEKDAY_KO[weekday_key(d)]


def week_dir(wid: str) -> Path:
    return OUTPUT_DIR / wid


# ──────────────────────────────────────────────────────────────
# 5. 게시물 ID·파일명
# ──────────────────────────────────────────────────────────────
def post_id(channel_key: str, date: _dt.date, slot: str) -> str:
    """중복 발행을 막는 고유 ID. 예: coin-2026-08-24-주간시황"""
    return f"{channel_key}-{date.isoformat()}-{slot}"


_SAFE_RE = re.compile(r"[^a-z0-9\-]+")


def safe_filename(text: str, fallback: str = "image") -> str:
    """
    이미지 파일명을 영문+숫자 조합으로 만듭니다.
    한글은 제거되므로 뜻이 사라지면 fallback 을 씁니다.
    """
    norm = unicodedata.normalize("NFKD", text)
    ascii_only = norm.encode("ascii", "ignore").decode("ascii").lower()
    cleaned = _SAFE_RE.sub("-", ascii_only).strip("-")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    return cleaned[:60] or fallback


def post_dir(wid: str, channel_key: str, date: _dt.date) -> Path:
    return week_dir(wid) / channel_key / date.isoformat()


# ──────────────────────────────────────────────────────────────
# 6. 상태 흐름
# ──────────────────────────────────────────────────────────────
#  글 하나가 지나가는 길입니다. 순서대로만 올라가고 건너뛸 수 없습니다.
#
#    draft                  원고 초안
#    fact_checked           본문 수치가 출처로 확인됨
#    reviewed               자동 검수 통과
#    approved               사람이 확인하고 승인함  ← 여기부터 네이버 작업 가능
#    editor_filled          네이버 편집기에 입력을 마침
#    draft_saved            비공개로 임시저장함 (아직 예약 아님)
#    reservation_requested  예약 버튼을 눌렀음 (아직 확인 전)
#    reservation_verified   네이버 예약 목록에서 제목·시각을 다시 확인함
#    published              예약 시각이 지나 실제로 올라감
#    post_publish_verified  올라간 글을 열어 이미지·태그까지 확인함
#
#  failed 은 위 순서와 별개입니다. 어느 단계에서든 멈출 수 있습니다.
STATUSES = [
    "draft", "fact_checked", "reviewed", "approved",
    "editor_filled", "draft_saved",
    "reservation_requested", "reservation_verified",
    "published", "post_publish_verified",
]
STATUS_KO = {
    "draft":                 "초안",
    "fact_checked":          "사실확인 완료",
    "reviewed":              "검수 완료",
    "approved":              "승인됨",
    "editor_filled":         "편집기 입력 완료",
    "draft_saved":           "비공개 임시저장",
    "reservation_requested": "예약 요청함",
    "reservation_verified":  "예약 확인됨",
    "published":             "발행됨",
    "post_publish_verified": "발행 확인 완료",
    "failed":                "실패 — 사람 확인 필요",
}

# 예약이나 공개 발행을 실행할 수 있는 최소 단계
PUBLISH_GATE = "approved"

# 화면 표시용 기호
STATUS_MARK = {
    "draft":                 "□",
    "fact_checked":          "◑",
    "reviewed":              "◕",
    "approved":              "●",
    "editor_filled":         "▣",
    "draft_saved":           "▤",
    "reservation_requested": "◇",
    "reservation_verified":  "◆",
    "published":             "★",
    "post_publish_verified":  "✦",
    "failed":                "✗",
}


def status_index(s: str) -> int:
    try:
        return STATUSES.index(s)
    except ValueError:
        return -1


def can_advance(current: str, target: str) -> bool:
    """상태는 순서대로만 올라갑니다. 건너뛰기 금지."""
    ci, ti = status_index(current), status_index(target)
    return ci >= 0 and ti >= 0 and ti == ci + 1


def at_least(current: str, minimum: str) -> bool:
    """현재 상태가 기준 단계 이상인가. (failed 는 항상 False)"""
    if current == "failed":
        return False
    ci, mi = status_index(current), status_index(minimum)
    return ci >= 0 and mi >= 0 and ci >= mi


def can_touch_naver(current: str) -> bool:
    """네이버 편집기를 열어 예약·발행까지 진행해도 되는 상태인가."""
    return at_least(current, PUBLISH_GATE)


# ──────────────────────────────────────────────────────────────
# 7. 로그
# ──────────────────────────────────────────────────────────────
_logger_cache: dict[str, logging.Logger] = {}


def get_logger(name: str = "naver-blog") -> logging.Logger:
    if name in _logger_cache:
        return _logger_cache[name]

    ensure_dir(LOG_DIR)
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    if not logger.handlers:
        fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s",
                                datefmt="%Y-%m-%d %H:%M:%S")
        fh = logging.FileHandler(
            LOG_DIR / f"{now_kst():%Y-%m}.log", encoding="utf-8"
        )
        fh.setFormatter(fmt)
        logger.addHandler(fh)

    _logger_cache[name] = logger
    return logger


# ──────────────────────────────────────────────────────────────
# 8. 화면 출력 — 비개발자가 읽을 수 있는 쉬운 한국어
# ──────────────────────────────────────────────────────────────
def disp_width(text: str) -> int:
    """
    화면에 찍히는 칸 수. 한글·한자·일본어는 두 칸을 차지합니다.
    표를 가지런히 맞추는 데 씁니다.
    """
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
               for ch in text)


def pad(text: str, width: int) -> str:
    """오른쪽을 공백으로 채워 화면 폭을 맞춥니다."""
    return text + " " * max(0, width - disp_width(text))


def clip(text: str, width: int) -> str:
    """화면 폭 기준으로 잘라내고 뒤에 … 를 붙입니다."""
    if disp_width(text) <= width:
        return text
    out, w = "", 0
    for ch in text:
        cw = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        if w + cw > width - 1:
            break
        out += ch
        w += cw
    return out + "…"


def say(msg: str = "") -> None:
    print(msg, flush=True)


def ok(msg: str) -> None:
    print(f"  [완료] {msg}", flush=True)


def info(msg: str) -> None:
    print(f"  · {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"  [확인 필요] {msg}", flush=True)
    get_logger().warning(msg)


def error(msg: str) -> None:
    print(f"  [오류] {msg}", flush=True)
    get_logger().error(msg)


def header(title: str) -> None:
    line = "─" * 58
    print(f"\n{line}\n  {title}\n{line}", flush=True)


class InputClosed(RuntimeError):
    """더 이상 입력을 받을 수 없는 상황 (Ctrl+D, 파이프 끝 등)."""


def from_gui() -> bool:
    """화면(GUI)에서 부른 것인지. 이때는 콘솔로 되물을 수 없습니다."""
    return os.environ.get("NBA_GUI") == "1"


def gui_confirmed() -> bool:
    """
    화면에서 사람이 이미 '예' 를 눌렀는지.

    화면 쪽에서 안내창을 띄우고 사람이 직접 누른 경우에만 켜집니다.
    스크립트가 스스로 켤 수 없습니다.
    """
    return os.environ.get("NBA_CONFIRMED") == "1"


def ask(prompt: str, default: str = "") -> str:
    if from_gui():
        # 화면에서 부르면 입력 통로가 막혀 있어 input() 이 그대로 죽습니다.
        # 되묻지 않고 분명히 멈춥니다.
        say(f"  {prompt}")
        say("  → 이 작업은 화면에서 답을 받을 수 없어 멈춥니다.")
        raise InputClosed
    suffix = f" [{default}]" if default else ""
    try:
        answer = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        # 입력이 끊겼습니다. 기본값으로 돌려주면 메뉴가 끝없이 반복되므로
        # 여기서 분명히 알려 주고 프로그램이 끝나게 합니다.
        print()
        raise InputClosed
    except KeyboardInterrupt:
        print()
        raise InputClosed
    return answer or default


def pause(prompt: str = "  확인이 끝나면 Enter 를 눌러 주세요 …") -> None:
    """
    사람이 화면을 볼 시간을 줍니다.

    화면(GUI)에서 부른 경우에는 Enter 를 받을 수 없으므로 기다리지 않고
    무엇을 하면 되는지만 알려 줍니다.
    """
    if from_gui():
        say("  브라우저 창은 열어 두었습니다. 확인이 끝나면 직접 닫아 주세요.")
        return
    try:
        input(prompt)
    except (EOFError, KeyboardInterrupt):
        print()


def confirm(prompt: str, default_yes: bool = False) -> bool:
    """
    사람에게 예/아니오를 묻습니다.

    화면에서 부른 경우에는 콘솔로 물을 수 없습니다.
    그래서 **화면에서 이미 확인을 받은 경우에만** 예로 봅니다.
    확인을 받지 못했으면 기본값과 상관없이 아니오입니다.
    (묻지 않고 넘어가서 실수로 글이 올라가는 일을 막습니다)
    """
    if from_gui():
        if gui_confirmed():
            say(f"  {prompt} → 화면에서 확인하셨습니다.")
            return True
        say(f"  {prompt}")
        say("  → 화면에서 확인을 받지 못해 멈춥니다.")
        return False
    hint = "Y/n" if default_yes else "y/N"
    answer = ask(f"{prompt} ({hint})").lower()
    if not answer:
        return default_yes
    return answer in ("y", "yes", "ㅇ", "예", "네")
