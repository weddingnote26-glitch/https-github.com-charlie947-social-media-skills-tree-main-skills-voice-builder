"""오락 숏폼 AI 스튜디오 — 시작점.

    python -m app.main

담당자는 바탕화면 아이콘을 눌러 실행합니다 (Stage 11 에서 설치파일을 만듭니다).
"""

from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication

from app.ui.main_window import MainWindow


def _open_store():
    """자료 폴더와 데이터베이스를 엽니다.

    **못 열어도 창은 뜹니다.** 클라우드 폴더에 깔렸거나 권한이 없어서
    열지 못할 수 있는데, 그때 프로그램이 아예 안 켜지면 담당자는
    무엇이 잘못됐는지도 알 수 없습니다. 설정 화면이 대신 알려줍니다.
    """
    try:
        from app.core.db import Database
        from app.core.paths import Paths
        from app.core.secrets import open_vault
        from app.services.registry import ProviderRegistry

        paths = Paths()
        paths.ensure_layout()
        db = Database(paths.db_path())
        try:
            금고 = open_vault(paths.credentials_path())
        except Exception:
            금고 = None            # 윈도우가 아니면 없습니다. 설정 화면이 알립니다.
        return db, ProviderRegistry(db, 금고)
    except Exception:
        return None, None


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("오락 숏폼 AI 스튜디오")
    db, registry = _open_store()
    window = MainWindow(db=db, registry=registry)
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
