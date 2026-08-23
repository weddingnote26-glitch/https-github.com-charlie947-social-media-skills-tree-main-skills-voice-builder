import { db, j } from "../db";
import type { StepState } from "./run";

/**
 * 제작 작업 목록 조회·삭제.
 *
 * 실패한 작업이 쌓이면 화면이 지저분해지고 무엇이 최신 실패인지 알기 어렵다.
 * 기록을 지워도 만들어진 릴스·영상 파일은 건드리지 않는다 — 작업 기록만 지운다.
 */

export interface JobRow {
  id: string;
  reel_id: string | null;
  steps: StepState[];
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  /** 어떤 릴스에 대한 작업이었는지 (있으면) */
  reel_title: string | null;
}

function toRow(r: {
  id: string; reel_id: string | null; steps_json: string; status: string;
  error: string | null; created_at: string; updated_at: string; reel_title: string | null;
}): JobRow {
  return {
    id: r.id, reel_id: r.reel_id, status: r.status, error: r.error,
    created_at: r.created_at, updated_at: r.updated_at, reel_title: r.reel_title,
    steps: j<StepState[]>(r.steps_json, []),
  };
}

const SELECT = `
  SELECT p.id, p.reel_id, p.steps_json, p.status, p.error, p.created_at, p.updated_at,
         r.title AS reel_title
  FROM production_jobs p
  LEFT JOIN reels r ON r.id = p.reel_id`;

export function listJobs(status?: string, limit = 100): JobRow[] {
  const rows = status
    ? db().prepare(`${SELECT} WHERE p.status=? ORDER BY p.created_at DESC LIMIT ?`).all(status, limit)
    : db().prepare(`${SELECT} ORDER BY p.created_at DESC LIMIT ?`).all(limit);
  return (rows as Parameters<typeof toRow>[0][]).map(toRow);
}

/**
 * 작업 기록 삭제.
 * 이미 사라진 id 가 섞여 있어도 오류를 내지 않는다 — 새로고침 후 같은 버튼을 두 번 눌러도
 * "없는 작업입니다" 로 막히지 않게 하기 위함(실제로 지워진 건 지워진 것이다).
 * 반환값은 이번 호출로 실제 삭제된 개수.
 */
export function deleteJobs(ids: string[]): number {
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x.trim()))];
  if (unique.length === 0) return 0;
  const d = db();
  let removed = 0;
  const stmt = d.prepare("DELETE FROM production_jobs WHERE id=? AND status<>'진행중'");
  for (const id of unique) {
    removed += stmt.run(id).changes;
  }
  return removed;
}

/** 실패한 작업 전체 삭제 — 진행 중인 작업은 건드리지 않는다 */
export function deleteJobsByStatus(status: string): number {
  if (status === "진행중") return 0; // 돌고 있는 작업은 지우지 않는다
  return db().prepare("DELETE FROM production_jobs WHERE status=?").run(status).changes;
}

export function countJobs(status: string): number {
  const row = db().prepare("SELECT COUNT(*) AS c FROM production_jobs WHERE status=?").get(status) as { c: number };
  return row.c;
}
