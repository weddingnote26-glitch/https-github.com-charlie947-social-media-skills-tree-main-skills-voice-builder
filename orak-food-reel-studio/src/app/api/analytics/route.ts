import { handle, ok } from "@/lib/api";
import { collectInsights, analyzePatterns } from "@/lib/analytics";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => {
    const recent = db().prepare(`
      SELECT r.id, r.title, r.planned_date, r.content_mode, r.content_type, p.permalink,
        (SELECT metrics_json FROM analytics a WHERE a.reel_id=r.id ORDER BY captured_at DESC LIMIT 1) AS metrics_json
      FROM reels r JOIN instagram_posts p ON p.reel_id=r.id
      ORDER BY r.planned_date DESC LIMIT 30
    `).all();
    return ok({ recent, patterns: analyzePatterns() });
  });
}

/** 지표 수집 실행 */
export async function POST() {
  return handle(async () => ok({ collected: await collectInsights() }));
}
