# -*- coding: utf-8 -*-
"""
네이버 블로그 도우미 — 실행 진입점.

이 파일이 실행파일(.exe)의 시작점입니다. 콘솔 창 없이 창 하나만 뜹니다.

한 가지 더 하는 일이 있습니다.
  실행파일로 묶이면 파이썬이 따로 없습니다. 그래서 화면에서 기존 스크립트를
  돌릴 때 **자기 자신을 다시 부르되** 첫 인자로 스크립트 경로를 넘깁니다.
  아래 _run_script_mode() 가 그 경우를 알아채고 화면 대신 그 스크립트를 돌립니다.
  (이때는 중복 실행 방지에도 걸리지 않습니다)
"""
from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))


def _run_script_mode() -> bool:
    """`앱.exe <스크립트.py> [인자…]` 로 불렸으면 그 스크립트를 돌립니다."""
    if len(sys.argv) < 2:
        return False
    target = Path(sys.argv[1])
    if target.suffix.lower() != ".py" or not target.exists():
        return False

    # scripts/ 안의 모듈끼리 서로 import 하므로 그 폴더들을 경로에 넣습니다.
    for p in (str(target.parent), str(target.parent.parent)):
        if p not in sys.path:
            sys.path.insert(0, p)

    sys.argv = sys.argv[1:]
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    runpy.run_path(str(target), run_name="__main__")
    return True


def main() -> int:
    if _run_script_mode():
        return 0
    from gui.main import main as gui_main
    return gui_main()


if __name__ == "__main__":
    sys.exit(main())
