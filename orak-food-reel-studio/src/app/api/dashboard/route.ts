import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { weekOverview } from "@/lib/content/strategy";
import { todayISO } from "@/lib/id";

export const dynamic = "force-dynamic";

/** §4 대시보드 데이터 */
export async function GET() {
  return handle(() => {
    const d = db();
    const today = todayISO();
    const count = (sql: string, ...p: unknown[]) => (d.prepare(sql).get(...p) as { c: number }).c;
    const stats = {
      today: {
        planned: count("SELECT COUNT(*) AS c FROM reels WHERE planned_date=? AND status IN ('기획','제작중')", today),
        done: count("SELECT COUNT(*) AS c FROM reels WHERE planned_date=? AND status IN ('검수','승인','예약','발행완료')", today),
        scheduled: count("SELECT COUNT(*) AS c FROM schedules WHERE publish_at LIKE ? AND status='예약'", `${today}%`),
        published: count("SELECT COUNT(*) AS c FROM schedules WHERE publish_at LIKE ? AND status='발행완료'", `${today}%`),
        failed: count("SELECT COUNT(*) AS c FROM reels WHERE planned_date=? AND status='실패'", today),
      },
      week: {
        produced: count("SELECT COUNT(*) AS c FROM reels WHERE planned_date>=date('now','weekday 1','-7 days') AND status NOT IN ('기획')"),
        published: count("SELECT COUNT(*) AS c FROM reels WHERE status='발행완료' AND planned_date>=date('now','weekday 1','-7 days')"),
        scheduled: count("SELECT COUNT(*) AS c FROM schedules WHERE status='예약'"),
        failed: count("SELECT COUNT(*) AS c FROM reels WHERE status='실패'"),
      },
      producing: d.prepare(
        "SELECT id, reel_id, steps_json, status, updated_at FROM production_jobs WHERE status='진행중' ORDER BY created_at DESC LIMIT 5"
      ).all(),
      recent: d.prepare(
        `SELECT r.id, r.title, r.status, r.planned_date, r.thumb_path, p.permalink
         FROM reels r LEFT JOIN instagram_posts p ON p.reel_id=r.id
         ORDER BY r.updated_at DESC LIMIT 8`
      ).all(),
      weekDays: weekOverview(),
    };
    return ok(stats);
  });
}
