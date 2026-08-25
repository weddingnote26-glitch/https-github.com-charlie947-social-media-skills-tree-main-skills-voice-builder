import { SqliteDatabase } from "./sqlite";
import path from "node:path";
import fs from "node:fs";
import { DIRS } from "./paths";
import { redact } from "./redact";

/**
 * SQLite 기본. 테이블 구조는 추후 PostgreSQL 이전이 쉽도록
 * JSON 컬럼 + 표준 SQL 타입만 사용합니다.
 */
let _db: SqliteDatabase | null = null;

export function db(): SqliteDatabase {
  if (_db) return _db;
  fs.mkdirSync(DIRS.data, { recursive: true });
  const file = process.env.ORAK_DB_PATH || path.join(DIRS.data, "orak-studio.db");
  _db = new SqliteDatabase(file);
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

/** 테스트용: 임시 DB로 교체 */
export function resetDbForTest(filePath: string): void {
  if (_db) _db.close();
  _db = null;
  process.env.ORAK_DB_PATH = filePath;
}

function migrate(d: SqliteDatabase): void {
  d.exec(`
  CREATE TABLE IF NOT EXISTS restaurants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '관악구',
    address TEXT, phone TEXT, map_url TEXT, source_url TEXT,
    menus_json TEXT NOT NULL DEFAULT '[]',        -- [{name, price, verified}]
    hours TEXT, closed_days TEXT, parking TEXT, reservation TEXT,
    features_json TEXT NOT NULL DEFAULT '[]',
    review_summary TEXT, pros_json TEXT NOT NULL DEFAULT '[]', cons_json TEXT NOT NULL DEFAULT '[]',
    recommended_for TEXT,
    field_status_json TEXT NOT NULL DEFAULT '{}', -- {필드명: "확인"|"미확인"}
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS content_ideas (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT REFERENCES restaurants(id),
    content_type TEXT NOT NULL,                   -- 가성비/숨은맛집/... 12종
    content_mode TEXT NOT NULL DEFAULT 'ORAKI_DETECTIVE', -- NORMAL_FOOD | ORAKI_DETECTIVE
    title TEXT, notes TEXT,
    planned_date TEXT,
    status TEXT NOT NULL DEFAULT '기획',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reels (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT REFERENCES restaurants(id),
    idea_id TEXT REFERENCES content_ideas(id),
    case_number INTEGER,                          -- 맛집사건 #NNN (오락이 모드)
    case_title TEXT,
    content_mode TEXT NOT NULL DEFAULT 'ORAKI_DETECTIVE',
    content_type TEXT NOT NULL DEFAULT '자동 추천',
    title TEXT NOT NULL DEFAULT '',
    script_json TEXT NOT NULL DEFAULT '{}',       -- ReelScript (Zod 검증)
    verdict_json TEXT NOT NULL DEFAULT '{}',      -- 오락이 탐정 판정
    caption TEXT NOT NULL DEFAULT '',
    hashtags_json TEXT NOT NULL DEFAULT '[]',
    quality_json TEXT NOT NULL DEFAULT '{}',      -- 품질점수 상세
    factcheck_json TEXT NOT NULL DEFAULT '[]',
    output_dir TEXT,
    video_path TEXT, thumb_path TEXT, srt_path TEXT, voice_path TEXT,
    duration_sec REAL,
    status TEXT NOT NULL DEFAULT '기획',          -- 기획/제작중/검수/승인/예약/발행완료/실패
    planned_date TEXT,                            -- YYYY-MM-DD
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    scene_no INTEGER NOT NULL,
    start_sec REAL NOT NULL, end_sec REAL NOT NULL,
    narration TEXT NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    visual_prompt TEXT NOT NULL DEFAULT '',
    camera_motion TEXT NOT NULL DEFAULT 'slow_zoom_in',
    character_action TEXT, character_expression TEXT,
    fact_source TEXT,
    image_path TEXT,
    image_hash TEXT,                              -- 캐시 키(비주얼 프롬프트 해시)
    UNIQUE (reel_id, scene_no)
  );

  CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    reel_id TEXT REFERENCES reels(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                           -- image/audio/video/thumb/srt/bgm
    path TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS production_jobs (
    id TEXT PRIMARY KEY,
    reel_id TEXT REFERENCES reels(id) ON DELETE SET NULL,
    steps_json TEXT NOT NULL DEFAULT '[]',        -- [{key,label,status,progress,message}]
    status TEXT NOT NULL DEFAULT '대기',          -- 대기/진행중/완료/실패/취소
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    publish_at TEXT NOT NULL,                     -- ISO 일시(로컬 기준 저장)
    status TEXT NOT NULL DEFAULT '예약',          -- 예약/발행중/발행완료/실패/취소
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS publishing_jobs (
    id TEXT PRIMARY KEY,
    reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    schedule_id TEXT REFERENCES schedules(id),
    phase TEXT NOT NULL DEFAULT '대기',           -- 대기/컨테이너생성/처리대기/발행/완료/실패
    container_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS instagram_posts (
    id TEXT PRIMARY KEY,
    reel_id TEXT NOT NULL REFERENCES reels(id),
    ig_media_id TEXT NOT NULL,
    permalink TEXT,
    published_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS analytics (
    id TEXT PRIMARY KEY,
    reel_id TEXT REFERENCES reels(id),
    ig_media_id TEXT,
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    metrics_json TEXT NOT NULL DEFAULT '{}'       -- views/reach/likes/comments/saved/shares 중 API 제공분만
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    service TEXT NOT NULL, action TEXT NOT NULL,
    ok INTEGER NOT NULL, status INTEGER, message TEXT
  );

  CREATE TABLE IF NOT EXISTS tips (                -- 맛집 제보 (§30)
    id TEXT PRIMARY KEY,
    restaurant_name TEXT NOT NULL,
    location TEXT, reason TEXT, submitted_by TEXT,
    status TEXT NOT NULL DEFAULT '제보',          -- 제보/조사예정/제작중/완료
    case_number INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS benchmarks (          -- 릴스 벤치마킹 (§58)
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    analysis_json TEXT NOT NULL DEFAULT '{}',
    template_json TEXT NOT NULL DEFAULT '{}',      -- 오락푸드용 재구성 템플릿
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS weekly_plans (
    id TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,                      -- 해당 주 월요일 YYYY-MM-DD
    items_json TEXT NOT NULL DEFAULT '[]',         -- [{date,content_type,content_mode,area,restaurantHint,ideaId?,reelId?}]
    status TEXT NOT NULL DEFAULT '기획',           -- 기획/승인/제작중/완료
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reels_status ON reels(status);
  CREATE INDEX IF NOT EXISTS idx_reels_planned ON reels(planned_date);
  CREATE INDEX IF NOT EXISTS idx_schedules_at ON schedules(publish_at, status);
  CREATE INDEX IF NOT EXISTS idx_pubjobs_phase ON publishing_jobs(phase);
  `);
}

/* ---------- 공용 헬퍼 ---------- */

export function j<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

export function apiLog(service: string, action: string, ok: boolean, status?: number, message?: string): void {
  try {
    db().prepare(
      "INSERT INTO api_logs (service, action, ok, status, message) VALUES (?,?,?,?,?)"
    ).run(service, action, ok ? 1 : 0, status ?? null, redact(message ?? "").slice(0, 500));
  } catch { /* 로그 실패 무시 */ }
}

/** 사건번호 발급 — 맛집사건 #NNN */
export function nextCaseNumber(): number {
  const row = db().prepare("SELECT MAX(case_number) AS m FROM reels").get() as { m: number | null };
  return (row.m ?? 0) + 1;
}
