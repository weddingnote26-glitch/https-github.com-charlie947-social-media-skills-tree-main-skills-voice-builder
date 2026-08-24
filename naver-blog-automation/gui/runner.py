# -*- coding: utf-8 -*-
"""
기존 파이썬 스크립트를 화면 뒤에서 돌립니다.

가장 중요한 것
  · **검은 콘솔 창이 절대 뜨지 않게** 합니다.
    CREATE_NO_WINDOW 와 STARTF_USESHOWWINDOW 를 함께 씁니다.
  · 화면이 멈추지 않도록 별도 흐름(QThread)에서 돌립니다.
  · 중간에 취소할 수 있습니다.
  · 나온 글은 그대로 화면과 로그 파일에 남깁니다.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from PySide6.QtCore import QThread, Signal


def _find_project_root() -> Path:
    """
    글·설정·기록이 실제로 들어 있는 폴더를 찾습니다.

    개발 중에는 이 파일의 상위 폴더입니다.
    실행파일로 묶이면 앱은 <프로젝트>\\dist\\<앱이름>\\ 안에 있으므로
    거기서 위로 올라가며 config\\channel_profiles.yaml 이 있는 곳을 찾습니다.
    (번들 안의 사본이 아니라 **고칠 수 있는 진짜 폴더**를 써야 합니다)
    """
    marker = Path("config") / "channel_profiles.yaml"

    if getattr(sys, "frozen", False):
        here = Path(sys.executable).resolve().parent
        for cand in (here, *here.parents):
            if (cand / marker).exists():
                return cand
        # 못 찾으면 번들에 함께 넣어 둔 사본을 씁니다.
        return Path(getattr(sys, "_MEIPASS", here))

    return Path(__file__).resolve().parent.parent


PROJECT_ROOT = _find_project_root()

# ── 콘솔 창을 띄우지 않는 설정 ──────────────────────────────
CREATE_NO_WINDOW = 0x08000000


def no_window_kwargs() -> dict:
    """윈도우에서 자식 프로세스가 창을 띄우지 않게 하는 옵션."""
    if os.name != "nt":
        return {}
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = subprocess.SW_HIDE
    return {"creationflags": CREATE_NO_WINDOW, "startupinfo": si}


def python_exe() -> str:
    """
    스크립트를 돌릴 파이썬.

    개발 중에는 전용 환경(.venv)을 씁니다.
    실행파일(.exe)로 묶인 뒤에는 자기 자신을 다시 부르면
    콘솔이 없는 상태로 돌아가므로 sys.executable 을 씁니다.
    """
    if getattr(sys, "frozen", False):
        return sys.executable
    venv = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
    return str(venv) if venv.exists() else sys.executable


def open_folder(path: Path) -> None:
    """탐색기로 폴더를 엽니다. 콘솔 창은 뜨지 않습니다."""
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    os.startfile(str(path))  # noqa: S606 - 폴더 열기 전용


class TaskRunner(QThread):
    """스크립트 하나를 돌리고 나온 글을 한 줄씩 넘겨줍니다."""

    line = Signal(str)        # 화면에 한 줄 출력
    finished_ok = Signal(int)  # 종료 코드
    failed = Signal(str)       # 사람이 읽을 수 있는 실패 사유

    def __init__(self, script: str, args: list[str] | None = None, parent=None):
        super().__init__(parent)
        self.script = script
        self.args = args or []
        self._proc: subprocess.Popen | None = None
        self._cancelled = False

    # ── 실행 ────────────────────────────────────────────────
    def run(self) -> None:  # noqa: D102
        target = PROJECT_ROOT / "scripts" / self.script
        if not target.exists():
            self.failed.emit(f"프로그램 파일을 찾지 못했습니다.\n\n{target}")
            return

        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        env["PYTHONUNBUFFERED"] = "1"
        # 화면에서 부른 것이므로 스크립트가 사람에게 되묻지 않게 합니다.
        env["NBA_GUI"] = "1"

        cmd = [python_exe(), str(target), *self.args]
        try:
            self._proc = subprocess.Popen(
                cmd,
                cwd=str(PROJECT_ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=env,
                **no_window_kwargs(),
            )
        except OSError as exc:
            self.failed.emit(f"프로그램을 시작하지 못했습니다.\n\n{exc}")
            return

        assert self._proc.stdout is not None
        for raw in self._proc.stdout:
            if self._cancelled:
                break
            self.line.emit(raw.rstrip("\n"))

        code = self._proc.wait()
        if self._cancelled:
            self.line.emit("")
            self.line.emit("  [멈춤] 사용자가 중간에 멈췄습니다.")
            self.finished_ok.emit(-1)
        else:
            self.finished_ok.emit(code)

    # ── 취소 ────────────────────────────────────────────────
    def cancel(self) -> None:
        self._cancelled = True
        proc = self._proc
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass


def run_quiet(script: str, args: list[str] | None = None, timeout: int = 60) -> tuple[int, str]:
    """
    짧은 조회용 — 화면을 막지 않을 만큼 빨리 끝나는 것에만 씁니다.
    콘솔 창은 뜨지 않습니다.
    """
    target = PROJECT_ROOT / "scripts" / script
    if not target.exists():
        return 1, f"파일을 찾지 못했습니다: {target}"

    env = dict(os.environ)
    env.update(PYTHONIOENCODING="utf-8", PYTHONUTF8="1", NBA_GUI="1")
    try:
        p = subprocess.run(
            [python_exe(), str(target), *(args or [])],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
            **no_window_kwargs(),
        )
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return 1, f"{timeout}초 안에 끝나지 않았습니다."
    except OSError as exc:
        return 1, str(exc)
