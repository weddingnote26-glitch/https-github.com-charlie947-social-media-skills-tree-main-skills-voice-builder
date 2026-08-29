"""SQLite — 표 5개 (지시서 §10-2).

    projects · project_urls · scenes · generation_jobs · settings

두 가지 규칙이 이 파일의 뼈대입니다.

1. **settings 표에 API 키를 넣지 않습니다.** 키는 DPAPI 금고에만 있습니다 (§10-3).
   ``put_setting()`` 이 열쇠처럼 생긴 값을 받으면 저장하지 않고 거부합니다.
2. **지우는 기능이 없습니다.** 한 Scene 이 실패해도 다른 Scene 을 지우지 않고,
   담당자가 만든 결과물도 프로그램이 임의로 정리하지 않습니다 (§0-1 4번 · 분리규칙 §3-3).
   실패한 Scene 은 상태만 바꿔 다시 만듭니다.
"""

from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional, Sequence

from app.contracts.models import (
    JobType,
    ProjectStatus,
    RenderMode,
    SceneStatus,
    VideoJob,
)
from app.core import masking

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    REAL NOT NULL,
    store_name    TEXT NOT NULL,
    area          TEXT NOT NULL DEFAULT '',
    address       TEXT NOT NULL DEFAULT '',
    menu          TEXT NOT NULL DEFAULT '',
    price         TEXT NOT NULL DEFAULT '',
    features      TEXT NOT NULL DEFAULT '',
    reason        TEXT NOT NULL DEFAULT '',
    memo          TEXT NOT NULL DEFAULT '',
    is_paid_promotion INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'draft',
    folder_path   TEXT NOT NULL DEFAULT ''
);

-- 담당자가 적어 넣은 참고 주소. 프로그램은 절대 열지 않습니다 (§0-4).
CREATE TABLE IF NOT EXISTS project_urls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id),
    url         TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scenes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id        INTEGER NOT NULL REFERENCES projects(id),
    idx               INTEGER NOT NULL,
    start_sec         REAL NOT NULL DEFAULT 0,
    end_sec           REAL NOT NULL DEFAULT 0,
    narration         TEXT NOT NULL DEFAULT '',
    screen_text       TEXT NOT NULL DEFAULT '',
    image_prompt      TEXT NOT NULL DEFAULT '',
    video_prompt      TEXT NOT NULL DEFAULT '',
    render_mode       TEXT NOT NULL DEFAULT 'kenburns',
    source_photo_path TEXT NOT NULL DEFAULT '',
    image_path        TEXT NOT NULL DEFAULT '',
    video_path        TEXT NOT NULL DEFAULT '',
    audio_path        TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'pending',
    error_msg         TEXT NOT NULL DEFAULT '',
    retry_count       INTEGER NOT NULL DEFAULT 0,
    UNIQUE (project_id, idx)
);

CREATE TABLE IF NOT EXISTS generation_jobs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id       INTEGER NOT NULL REFERENCES projects(id),
    scene_id         INTEGER,
    provider         TEXT NOT NULL,
    job_type         TEXT NOT NULL,
    external_task_id TEXT NOT NULL DEFAULT '',
    vendor_task_id   TEXT NOT NULL DEFAULT '',
    scene_idx        INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'submitted',
    request_at       REAL NOT NULL,
    updated_at       REAL NOT NULL,
    cost_estimate_krw INTEGER NOT NULL DEFAULT 0,
    error_code       TEXT NOT NULL DEFAULT ''
);

-- API 키는 여기 저장하지 않습니다 (§10-2). put_setting() 이 막습니다.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project   ON generation_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status    ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_external  ON generation_jobs(external_task_id);
"""

UNFINISHED = ("submitted", "processing")


class SecretInSettings(Exception):
    """열쇠처럼 생긴 값을 settings 표에 넣으려 했습니다.

    설계가 잘못된 것입니다. 키는 DPAPI 금고에만 둡니다 (§10-2 · MVP 판정 18번).
    """


class Database:
    def __init__(self, path: Path, masker: Optional[masking.Masker] = None) -> None:
        self._path = Path(path)
        self._masker = masker or masking.default_masker()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._path))
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(SCHEMA)
        self._conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            ("schema_version", str(SCHEMA_VERSION)),
        )
        self._conn.commit()

    @property
    def path(self) -> Path:
        return self._path

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Cursor]:
        cur = self._conn.cursor()
        try:
            yield cur
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        finally:
            cur.close()

    # ── 프로젝트 ──────────────────────────────────────────
    def create_project(self, *, store_name: str, folder_path: str, area: str = "",
                       address: str = "", menu: str = "", price: str = "",
                       features: str = "", reason: str = "", memo: str = "",
                       is_paid_promotion: bool = False) -> int:
        with self._tx() as cur:
            cur.execute(
                """INSERT INTO projects
                   (created_at, store_name, area, address, menu, price, features,
                    reason, memo, is_paid_promotion, status, folder_path)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (time.time(), store_name, area, address, menu, price, features,
                 reason, memo, int(is_paid_promotion), ProjectStatus.DRAFT.value,
                 folder_path),
            )
            return int(cur.lastrowid)

    def get_project(self, project_id: int) -> Optional[dict[str, Any]]:
        row = self._conn.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return dict(row) if row else None

    def list_projects(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM projects ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def set_project_status(self, project_id: int, status: ProjectStatus) -> None:
        with self._tx() as cur:
            cur.execute("UPDATE projects SET status = ? WHERE id = ?",
                        (status.value, project_id))

    # ── 참고 주소 (저장만 · 열지 않음) ────────────────────
    def add_url(self, project_id: int, url: str, note: str = "") -> int:
        with self._tx() as cur:
            cur.execute(
                "INSERT INTO project_urls (project_id, url, note) VALUES (?,?,?)",
                (project_id, url, note))
            return int(cur.lastrowid)

    def urls(self, project_id: int) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM project_urls WHERE project_id = ? ORDER BY id",
            (project_id,)).fetchall()
        return [dict(r) for r in rows]

    # ── Scene ─────────────────────────────────────────────
    def add_scene(self, project_id: int, *, idx: int, start_sec: float, end_sec: float,
                  render_mode: RenderMode, narration: str = "", screen_text: str = "",
                  image_prompt: str = "", video_prompt: str = "",
                  source_photo_path: str = "") -> int:
        with self._tx() as cur:
            cur.execute(
                """INSERT INTO scenes
                   (project_id, idx, start_sec, end_sec, narration, screen_text,
                    image_prompt, video_prompt, render_mode, source_photo_path, status)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (project_id, idx, start_sec, end_sec, narration, screen_text,
                 image_prompt, video_prompt, render_mode.value, source_photo_path,
                 SceneStatus.PENDING.value),
            )
            return int(cur.lastrowid)

    def scenes(self, project_id: int) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM scenes WHERE project_id = ? ORDER BY idx",
            (project_id,)).fetchall()
        return [dict(r) for r in rows]

    def set_scene_status(self, scene_id: int, status: SceneStatus, *,
                         error_msg: str = "", bump_retry: bool = False) -> None:
        """**한 Scene 이 실패해도 다른 Scene 을 건드리지 않습니다** (§10-2).

        error_msg 는 담당자에게 보여줄 한국어입니다. 벤더 원문이 아닙니다.
        혹시 몰라 마스킹을 한 번 더 거칩니다.
        """
        with self._tx() as cur:
            if bump_retry:
                cur.execute(
                    "UPDATE scenes SET status=?, error_msg=?, retry_count=retry_count+1"
                    " WHERE id=?",
                    (status.value, self._masker.scrub(error_msg), scene_id))
            else:
                cur.execute(
                    "UPDATE scenes SET status=?, error_msg=? WHERE id=?",
                    (status.value, self._masker.scrub(error_msg), scene_id))

    def set_scene_output(self, scene_id: int, *, image_path: str | None = None,
                         video_path: str | None = None,
                         audio_path: str | None = None) -> None:
        """만들어진 파일의 **로컬 경로**를 적습니다.

        Kling 결과는 30일 뒤 삭제되므로 주소가 아니라 내려받은 경로를 적습니다
        (MVP 판정 20번).
        """
        sets, vals = [], []
        for col, val in (("image_path", image_path), ("video_path", video_path),
                         ("audio_path", audio_path)):
            if val is not None:
                sets.append(f"{col} = ?")
                vals.append(val)
        if not sets:
            return
        vals.append(scene_id)
        with self._tx() as cur:
            cur.execute(f"UPDATE scenes SET {', '.join(sets)} WHERE id = ?", vals)

    # ── 작업 기록 ─────────────────────────────────────────
    def record_job(self, *, project_id: int, provider: str, job_type: JobType,
                   external_task_id: str = "", vendor_task_id: str = "",
                   scene_id: Optional[int] = None, scene_idx: int = 0,
                   status: str = "submitted", cost_estimate_krw: int = 0,
                   error_code: str = "") -> int:
        now = time.time()
        with self._tx() as cur:
            cur.execute(
                """INSERT INTO generation_jobs
                   (project_id, scene_id, provider, job_type, external_task_id,
                    vendor_task_id, scene_idx, status, request_at, updated_at,
                    cost_estimate_krw, error_code)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (project_id, scene_id, provider, job_type.value, external_task_id,
                 vendor_task_id, scene_idx, status, now, now, cost_estimate_krw,
                 error_code),
            )
            return int(cur.lastrowid)

    def update_job(self, job_id: int, *, status: str,
                   vendor_task_id: str | None = None,
                   error_code: str | None = None) -> None:
        sets = ["status = ?", "updated_at = ?"]
        vals: list[Any] = [status, time.time()]
        if vendor_task_id is not None:
            sets.append("vendor_task_id = ?")
            vals.append(vendor_task_id)
        if error_code is not None:
            sets.append("error_code = ?")
            vals.append(error_code)
        vals.append(job_id)
        with self._tx() as cur:
            cur.execute(f"UPDATE generation_jobs SET {', '.join(sets)} WHERE id = ?", vals)

    def unfinished_video_jobs(self) -> list[VideoJob]:
        """프로그램을 다시 켰을 때 이어서 조회할 작업들 (MVP 판정 12번).

        여기서 돌려준 값만으로 ``VideoProvider.poll()`` 이 동작해야 합니다.
        """
        rows = self._conn.execute(
            "SELECT * FROM generation_jobs WHERE job_type = ? AND status IN (?,?)"
            " ORDER BY request_at",
            (JobType.VIDEO.value, *UNFINISHED)).fetchall()
        return [
            VideoJob(
                provider=r["provider"],
                scene_idx=r["scene_idx"],
                external_task_id=r["external_task_id"],
                vendor_task_id=r["vendor_task_id"],
                submitted_at=r["request_at"],
            )
            for r in rows
        ]

    def month_to_date_krw(self, *, now: Optional[float] = None) -> int:
        """이번 달 누적 사용액. 화면 하단에 항상 표시합니다 (§11)."""
        import datetime as _dt

        ts = now if now is not None else time.time()
        today = _dt.datetime.fromtimestamp(ts)
        start = _dt.datetime(today.year, today.month, 1).timestamp()
        row = self._conn.execute(
            "SELECT COALESCE(SUM(cost_estimate_krw), 0) AS total FROM generation_jobs"
            " WHERE request_at >= ?", (start,)).fetchone()
        return int(row["total"])

    # ── 설정 (열쇠 금지) ──────────────────────────────────
    def put_setting(self, key: str, value: str) -> None:
        """설정 하나를 저장합니다.

        **열쇠처럼 생긴 값은 거부합니다** (§10-2). 마스킹이 무언가를 지웠다는 것은
        그 값이 열쇠라는 뜻이므로, DB 에 넣지 않고 예외를 올립니다.
        """
        if not self._masker.is_clean(value):
            raise SecretInSettings(
                f"설정 「{key}」 에 열쇠처럼 보이는 값이 들어왔습니다. "
                "API 키는 DPAPI 금고에만 저장합니다."
            )
        with self._tx() as cur:
            cur.execute(
                "INSERT INTO settings (key, value) VALUES (?,?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value))

    def get_setting(self, key: str, default: str = "") -> str:
        row = self._conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def all_settings(self) -> dict[str, str]:
        return {r["key"]: r["value"]
                for r in self._conn.execute("SELECT key, value FROM settings")}

    def table_names(self) -> list[str]:
        rows = self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
            " AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        return [r["name"] for r in rows]
