import { db, j } from "./db";
import type { ReelScript, Scene, FactCheckItem } from "./schema";

export interface ReelRow {
  id: string;
  restaurant_id: string | null;
  case_number: number | null;
  case_title: string | null;
  content_mode: string;
  content_type: string;
  title: string;
  script_json: string;
  verdict_json: string;
  caption: string;
  hashtags_json: string;
  quality_json: string;
  factcheck_json: string;
  /** §5 발행 전 검수 체크 상태 */
  review_json: string;
  output_dir: string | null;
  video_path: string | null;
  thumb_path: string | null;
  srt_path: string | null;
  voice_path: string | null;
  duration_sec: number | null;
  status: string;
  planned_date: string | null;
  /** 소프트 삭제 시각 — 값이 있으면 휴지통에 있는 것 */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function getReel(id: string): (ReelRow & { script: ReelScript | null; scenes: Scene[] }) | null {
  const row = db().prepare("SELECT * FROM reels WHERE id=?").get(id) as ReelRow | undefined;
  if (!row) return null;
  const scenes = db().prepare("SELECT * FROM scenes WHERE reel_id=? ORDER BY scene_no").all(id) as Array<{
    scene_no: number; start_sec: number; end_sec: number; narration: string; subtitle: string;
    visual_prompt: string; camera_motion: string; character_action: string | null;
    character_expression: string | null; fact_source: string | null; image_path: string | null; image_hash: string | null;
  }>;
  const script = j<ReelScript | null>(row.script_json, null);
  return {
    ...row,
    script,
    scenes: scenes.map((s) => ({
      scene: s.scene_no,
      start: s.start_sec,
      end: s.end_sec,
      narration: s.narration,
      subtitle: s.subtitle,
      visual_prompt: s.visual_prompt,
      camera_motion: (s.camera_motion || "slow_zoom_in") as Scene["camera_motion"],
      character_action: (s.character_action ?? null) as Scene["character_action"],
      character_expression: (s.character_expression ?? null) as Scene["character_expression"],
      character_presence: "none",
      fact_source: s.fact_source ?? "",
      image_path: s.image_path,
      image_hash: s.image_hash,
    })),
  };
}

export function saveScenes(reelId: string, scenes: Scene[]): void {
  const d = db();
  const del = d.prepare("DELETE FROM scenes WHERE reel_id=?");
  const ins = d.prepare(
    `INSERT INTO scenes (id, reel_id, scene_no, start_sec, end_sec, narration, subtitle, visual_prompt,
     camera_motion, character_action, character_expression, fact_source, image_path, image_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const tx = d.transaction(() => {
    del.run(reelId);
    for (const s of scenes) {
      ins.run(
        `${reelId}-s${s.scene}`, reelId, s.scene, s.start, s.end, s.narration, s.subtitle,
        s.visual_prompt, s.camera_motion, s.character_action ?? null, s.character_expression ?? null,
        s.fact_source, s.image_path ?? null, s.image_hash ?? null,
      );
    }
  });
  tx();
}

export function updateReel(id: string, patch: Partial<Record<keyof ReelRow, unknown>>): void {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k}=?`).join(", ");
  db().prepare(`UPDATE reels SET ${sets}, updated_at=datetime('now') WHERE id=?`)
    .run(...keys.map((k) => (patch as Record<string, unknown>)[k]), id);
}

export function listReels(where?: { status?: string; date?: string; trash?: boolean }): ReelRow[] {
  let sql = "SELECT * FROM reels";
  // 소프트 삭제된 것은 휴지통에서만 보인다 — 파일과 기록은 그대로 있다
  const cond: string[] = [where?.trash ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"];
  const params: unknown[] = [];
  if (where?.status) { cond.push("status=?"); params.push(where.status); }
  if (where?.date) { cond.push("planned_date=?"); params.push(where.date); }
  sql += " WHERE " + cond.join(" AND ");
  sql += " ORDER BY created_at DESC LIMIT 200";
  return db().prepare(sql).all(...params) as unknown as ReelRow[];
}

export function reelFactcheck(row: ReelRow): FactCheckItem[] {
  return j<FactCheckItem[]>(row.factcheck_json, []);
}
