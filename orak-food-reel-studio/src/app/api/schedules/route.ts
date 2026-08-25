import { handle, ok, fail } from "@/lib/api";
import { db, j } from "@/lib/db";
import { rescheduleAt, cancelSchedule, publishNow, tick, earliestSlot, SCHEDULE_TIMEZONE } from "@/lib/scheduler";
import { igAuthStatus } from "@/lib/providers/instagram";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface Row {
  id: string; reel_id: string; publish_at: string; status: string; created_at: string;
  title: string; restaurant_name: string | null; video_path: string | null;
}

/** §8 예약 목록 — 예약 시각·업체·제목·계정·상태 */
export async function GET() {
  return handle(() => {
    const rows = db().prepare(`
      SELECT s.id, s.reel_id, s.publish_at, s.status, s.created_at,
             r.title, r.video_path, t.name AS restaurant_name
        FROM schedules s
        JOIN reels r ON r.id = s.reel_id
   LEFT JOIN restaurants t ON t.id = r.restaurant_id
    ORDER BY s.publish_at ASC
    `).all() as unknown as Row[];
    const who = igAuthStatus();
    return ok({
      schedules: rows,
      account: who.userId ? `@${who.userId}` : "(계정 미설정)",
      timezone: SCHEDULE_TIMEZONE,
      earliest: earliestSlot(),
      /* 이 프로그램은 이 PC 안에서 돌아간다. 꺼져 있으면 예약 시각이 지나도
         발행되지 않는다 — 숨기지 말고 화면에 그대로 알린다. */
      needsAppRunning: true,
      /** 설치형 앱이면 ORAK_HOME 이 프로그램 폴더 밖을 가리킨다 */
      desktop: !!process.env.ORAK_HOME,
    });
  });
}

const Body = z.object({
  id: z.string().min(1),
  action: z.enum(["reschedule", "cancel", "publishNow"]),
  publishAt: z.string().optional(),
  /** 지금 발행은 외부에 공개되는 일이라 확인을 받는다 (§7) */
  confirmed: z.boolean().optional(),
  requestKey: z.string().min(8).max(64).optional(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    if (body.action === "reschedule") {
      if (!body.publishAt) return fail("바꿀 발행 시각이 없습니다");
      return ok(rescheduleAt(body.id, body.publishAt));
    }
    if (body.action === "cancel") {
      cancelSchedule(body.id);
      return ok({ cancelled: body.id });
    }
    // publishNow — 예약 목록에서 [지금 발행]
    if (!body.confirmed) {
      return fail("최종 확인 후에만 발행할 수 있습니다. 미리보기 화면에서 [게시하기] 를 눌러 주세요.");
    }
    const row = db().prepare("SELECT reel_id FROM schedules WHERE id=?").get(body.id) as { reel_id: string } | undefined;
    if (!row) return fail("예약을 찾을 수 없습니다", 404);
    const out = publishNow(row.reel_id, body.requestKey);
    void tick();
    return ok(out);
  });
}
