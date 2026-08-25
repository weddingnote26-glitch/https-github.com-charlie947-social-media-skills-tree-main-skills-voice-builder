import { handle, ok, fail } from "@/lib/api";
import { db } from "@/lib/db";
import { z } from "zod";
import { updateReel } from "@/lib/reels";

export const dynamic = "force-dynamic";

/** §30 콘텐츠 캘린더 — 월 데이터 + Drag&Drop 날짜 변경 */
export async function GET(req: Request) {
  return handle(() => {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const rows = db().prepare(
      `SELECT id, title, status, planned_date, content_mode, case_number FROM reels
       WHERE planned_date LIKE ? ORDER BY planned_date`
    ).all(`${month}%`) as Array<{ id: string; title: string; status: string; planned_date: string; content_mode: string; case_number: number | null }>;
    const schedules = db().prepare(
      `SELECT s.reel_id, s.publish_at, s.status FROM schedules s WHERE s.publish_at LIKE ?`
    ).all(`${month}%`) as Array<{ reel_id: string; publish_at: string; status: string }>;
    return ok({ month, reels: rows, schedules });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const body = z.object({ reelId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .safeParse(await req.json());
    if (!body.success) return fail("reelId와 date(YYYY-MM-DD)가 필요합니다");
    updateReel(body.data.reelId, { planned_date: body.data.date });
    // 미발행 예약도 같이 이동
    const sch = db().prepare(
      "SELECT id, publish_at FROM schedules WHERE reel_id=? AND status='예약'"
    ).all(body.data.reelId) as Array<{ id: string; publish_at: string }>;
    for (const s of sch) {
      const time = s.publish_at.slice(11) || "11:30:00";
      db().prepare("UPDATE schedules SET publish_at=? WHERE id=?").run(`${body.data.date}T${time}`, s.id);
    }
    return ok({ moved: true });
  });
}
