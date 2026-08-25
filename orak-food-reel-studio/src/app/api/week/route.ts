import { handle, ok, fail } from "@/lib/api";
import { buildWeeklyPlan, mondayOf } from "@/lib/content/strategy";
import { db, j } from "@/lib/db";
import { newId } from "@/lib/id";
import { WeeklyItemSchema, type WeeklyItem } from "@/lib/schema";
import { createJob, runProductionJob } from "@/lib/pipeline/run";
import { getSettings } from "@/lib/settings";
import { logError, logInfo } from "@/lib/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** §29 이번 주 릴스 6개 — 기획안 생성/조회/승인(순차 제작) */
export async function GET() {
  return handle(() => {
    const week = mondayOf();
    const row = db().prepare("SELECT * FROM weekly_plans WHERE week_start=? ORDER BY created_at DESC LIMIT 1").get(week) as
      | { id: string; items_json: string; status: string } | undefined;
    return ok({ weekStart: week, plan: row ? { id: row.id, status: row.status, items: j<WeeklyItem[]>(row.items_json, []) } : null });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = z.object({
      action: z.enum(["generate", "approve", "updateItems"]),
      planId: z.string().optional(),
      items: z.array(WeeklyItemSchema).optional(),
    }).parse(await req.json());
    const week = mondayOf();

    if (body.action === "generate") {
      const items = buildWeeklyPlan(week);
      const id = newId("wk");
      db().prepare("INSERT INTO weekly_plans (id, week_start, items_json, status) VALUES (?,?,?,'기획')")
        .run(id, week, JSON.stringify(items));
      return ok({ id, items });
    }

    if (!body.planId) return fail("planId가 필요합니다");
    const row = db().prepare("SELECT * FROM weekly_plans WHERE id=?").get(body.planId) as
      | { id: string; items_json: string } | undefined;
    if (!row) return fail("기획안을 찾을 수 없습니다", 404);

    if (body.action === "updateItems") {
      if (!body.items) return fail("items가 필요합니다");
      db().prepare("UPDATE weekly_plans SET items_json=? WHERE id=?").run(JSON.stringify(body.items), body.planId);
      return ok({ updated: true });
    }

    // 전체 승인 → 순차 제작 (§29)
    const items = body.items ?? j<WeeklyItem[]>(row.items_json, []);
    db().prepare("UPDATE weekly_plans SET status='제작중', items_json=? WHERE id=?").run(JSON.stringify(items), body.planId);
    const duration = getSettings().reelDurationSec;
    void (async () => {
      for (const item of items) {
        if (item.reel_id) continue; // 이미 제작된 항목 건너뜀
        const jobId = createJob();
        try {
          await runProductionJob(jobId, {
            restaurantName: item.restaurant_hint || `${item.area} ${item.content_type}`,
            area: item.area,
            contentType: item.content_type,
            contentMode: item.content_mode,
            durationSec: duration,
            plannedDate: item.date,
          });
          const jobRow = db().prepare("SELECT reel_id FROM production_jobs WHERE id=?").get(jobId) as { reel_id: string | null };
          item.reel_id = jobRow.reel_id;
          item.status = "제작완료";
        } catch (e) {
          item.status = "실패";
          logError("week", `${item.date} 제작 실패: ${e instanceof Error ? e.message : e}`);
        }
        db().prepare("UPDATE weekly_plans SET items_json=? WHERE id=?").run(JSON.stringify(items), body.planId);
      }
      db().prepare("UPDATE weekly_plans SET status='완료' WHERE id=?").run(body.planId);
      logInfo("week", "주간 제작 완료");
    })();
    return ok({ started: true, count: items.filter((i) => !i.reel_id).length });
  });
}
