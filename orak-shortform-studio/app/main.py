"""오락 숏폼 AI 스튜디오 — 시작점.

    python -m app.main

담당자는 바탕화면 아이콘을 눌러 실행합니다 (Stage 11 에서 설치파일을 만듭니다).
"""

from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication

from app.ui.main_window import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("오락 숏폼 AI 스튜디오")
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
