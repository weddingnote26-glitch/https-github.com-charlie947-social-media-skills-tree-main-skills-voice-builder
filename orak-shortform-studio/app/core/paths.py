"""폴더 위치와 **쓰기 허용 범위** (지시서 §10-1 · 분리규칙 §2).

분리규칙의 표를 사람의 주의력에 맡기지 않고 코드가 지키게 합니다.
파일을 쓰기 전에는 반드시 ``assert_writable()`` 를 거칩니다.

    내 문서\\ORAK_SHORTFORM_STUDIO\\      ← 여기 아래만 쓸 수 있습니다
      ├ Projects\\20260901_할머니국수\\
      │    ├ source\\ script\\ images\\ videos\\ audio\\ subtitle\\ final\\
      ├ Settings\\
      ├ Assets\\
      └ Logs\\

**지우는 기능이 없습니다.** 분리규칙 §3-3 이 금지했고, 담당자가 만든 영상을
프로그램이 임의로 정리하면 안 되기 때문입니다 (§0-1 4번).
"""

from __future__ import annotations

import os
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

APP_DIR_NAME = "ORAK_SHORTFORM_STUDIO"

SCENE_SUBDIRS = ("source", "script", "images", "videos", "audio", "subtitle", "final")
TOP_SUBDIRS = ("Projects", "Settings", "Assets", "Logs",
               "Cache", "Exports", "Temp")
"""Projects·Settings·Assets·Logs 는 지시서 §10-1.
Cache·Exports·Temp 는 나중에 쓸 자리를 미리 열어둔 것입니다.
비어 있어도 문제없습니다."""

# 절대 쓰면 안 되는 곳. 분리규칙 §2·§3-2.
# **와일드카드로 찾지 않습니다.** 두 프로그램 폴더가 모두 「오락_」 으로 시작해서
# 「오락_당근_콘텐츠」 를 찾다가 「오락_당근_배포도구」 가 걸리면 안 됩니다.
FORBIDDEN_NAMES = (
    "오락_당근_콘텐츠",
    "오락_당근_배포도구",
    "오락이 마스터 파일",
    "오락_숏폼스튜디오",
)


class WriteNotAllowed(Exception):
    """허용되지 않은 곳에 쓰려 했습니다. 설계가 잘못된 것이니 우회하지 마세요."""

    def __init__(self, path: Path, reason: str) -> None:
        super().__init__(reason)
        self.path = path
        self.reason = reason


def _name_parts(p: Path | str) -> set[str]:
    """경로에 들어 있는 폴더·파일 이름들.

    ``\\`` 와 ``/`` 를 **둘 다** 구분자로 봅니다.
    리눅스에서는 ``\\`` 가 구분자가 아니라서, 윈도우 경로를 그대로 받으면
    ``C:\\Users\\...\\오락_당근_콘텐츠\\a.txt`` 전체가 이름 하나로 잡힙니다.
    그러면 금지 폴더 대조가 헛돌아 「왜 막혔는지」 를 엉뚱하게 알려주게 됩니다.
    개발은 리눅스에서 하고 실행은 윈도우에서 하므로 양쪽 다 되어야 합니다.
    """
    text = unicodedata.normalize("NFC", str(p))
    return {part for part in re.split(r"[\\/]+", text) if part}


def _norm(p: Path) -> Path:
    """비교하기 좋게 다듬습니다.

    맥과 윈도우가 한글 파일명을 다르게 저장해서(자모 분리) 같은 이름이
    달라 보이는 일이 있습니다. NFC 로 맞춰 둡니다.
    """
    text = unicodedata.normalize("NFC", str(p))
    return Path(os.path.normpath(text)).absolute()


def _is_within(child: Path, parent: Path) -> bool:
    """child 가 parent 안에 있는가. 이름이 비슷한 옆 폴더는 걸러냅니다.

    ``/a/blog2`` 는 ``/a/blog`` 안이 아닙니다. 문자열 startswith 로 비교하면
    이걸 놓칩니다.
    """
    try:
        _norm(child).relative_to(_norm(parent))
        return True
    except ValueError:
        return False


def safe_folder_name(text: str) -> str:
    """폴더 이름으로 쓸 수 있게 다듬습니다. 한글은 그대로 둡니다."""
    cleaned = re.sub(r'[\\/:*?"<>|]', "", text).strip().strip(".")
    cleaned = re.sub(r"\s+", "", cleaned)
    return cleaned or "이름없음"


class Paths:
    """폴더 위치를 알려주고, 써도 되는 곳인지 검사합니다."""

    def __init__(self, data_root: Path | None = None,
                 bundled_assets: Path | None = None) -> None:
        self._data_root = _norm(Path(data_root) if data_root else self._default_data_root())
        self._bundled = _norm(Path(bundled_assets) if bundled_assets
                              else self._default_bundled_assets())

    # ── 기본 위치 ─────────────────────────────────────────
    @staticmethod
    def _default_data_root() -> Path:
        """내 문서\\ORAK_SHORTFORM_STUDIO\\ (분리규칙 §1)"""
        home = Path.home()
        for candidate in ("Documents", "내 문서", "문서"):
            docs = home / candidate
            if docs.is_dir():
                return docs / APP_DIR_NAME
        return home / "Documents" / APP_DIR_NAME

    @staticmethod
    def _default_bundled_assets() -> Path:
        """동봉된 자산 폴더. 읽기 전용.

        - EXE 실행: PyInstaller 가 풀어놓은 임시 폴더
        - 개발 중  : 저장소의 assets/
        """
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass) / "assets"
        return Path(__file__).resolve().parents[2] / "assets"

    # ── 알려주기 ──────────────────────────────────────────
    def data_root(self) -> Path:
        return self._data_root

    def bundled_assets_dir(self) -> Path:
        return self._bundled

    def projects_dir(self) -> Path:
        return self._data_root / "Projects"

    def settings_dir(self) -> Path:
        return self._data_root / "Settings"

    def logs_dir(self) -> Path:
        return self._data_root / "Logs"

    def cache_dir(self) -> Path:
        return self._data_root / "Cache"

    def exports_dir(self) -> Path:
        return self._data_root / "Exports"

    def temp_dir(self) -> Path:
        return self._data_root / "Temp"

    def db_path(self) -> Path:
        return self._data_root / "Settings" / "studio.db"

    def credentials_path(self) -> Path:
        """열쇠 금고. 암호문만 들어갑니다 (§10-3)."""
        return self._data_root / "Settings" / "credentials.dat"

    def master_images(self, filenames: list[str]) -> list[Path]:
        return [self._bundled / "master" / f for f in filenames]

    # ── 쓰기 가드 ─────────────────────────────────────────
    def assert_writable(self, path: Path) -> Path:
        """여기에 써도 되는가. 아니면 즉시 예외.

        허용: ``data_root()`` 아래.
        금지: 그 밖의 모든 곳 — 바탕화면 전체, A(당근 카드뉴스)의 모든 폴더,
              동봉 자산 폴더, 저장소 폴더.
        """
        target = _norm(Path(path))

        # 원본 문자열로 봅니다. 윈도우 경로를 리눅스에서 받아도 이름이 잡히게.
        hit = _name_parts(path) & set(FORBIDDEN_NAMES)
        if hit:
            raise WriteNotAllowed(
                target, f"다른 프로그램의 폴더입니다: {', '.join(sorted(hit))}")

        if _is_within(target, self._bundled):
            raise WriteNotAllowed(target, "동봉된 자산 폴더는 읽기 전용입니다.")

        if not _is_within(target, self._data_root):
            raise WriteNotAllowed(
                target, f"이 프로그램은 「{self._data_root}」 아래에만 쓸 수 있습니다.")

        return target

    def is_writable(self, path: Path) -> bool:
        try:
            self.assert_writable(path)
        except WriteNotAllowed:
            return False
        return True

    # ── 만들기 ────────────────────────────────────────────
    def ensure_layout(self) -> Path:
        """기본 폴더들을 만듭니다. 이미 있으면 그대로 둡니다."""
        for name in TOP_SUBDIRS:
            d = self._data_root / name
            self.assert_writable(d)
            d.mkdir(parents=True, exist_ok=True)
        return self._data_root

    def new_project_dir(self, store_name: str, on: date | None = None) -> Path:
        """``Projects\\20260901_할머니국수\\`` 를 만들고 하위 폴더까지 만듭니다.

        **같은 이름이 이미 있으면 덮지 않고** ``_2`` ``_3`` 을 붙입니다 (§0-1 3번).
        만들어진 경로를 돌려주므로, 뒤에 붙은 번호는 부르는 쪽이 보고 알려주면 됩니다.
        """
        day = (on or date.today()).strftime("%Y%m%d")
        base = f"{day}_{safe_folder_name(store_name)}"

        parent = self.projects_dir()
        self.assert_writable(parent)
        parent.mkdir(parents=True, exist_ok=True)

        target = parent / base
        n = 2
        while target.exists():
            target = parent / f"{base}_{n}"
            n += 1

        self.assert_writable(target)
        for sub in SCENE_SUBDIRS:
            (target / sub).mkdir(parents=True, exist_ok=True)
        return target

    def log_file(self, on: date | None = None) -> Path:
        day = (on or date.today()).strftime("%Y%m%d")
        p = self.logs_dir() / f"{day}.log"
        self.assert_writable(p)
        return p
