import { handle, ok, fail } from "@/lib/api";
import { getReel, updateReel, saveScenes } from "@/lib/reels";
import { SceneSchema } from "@/lib/schema";
import { db } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const reel = getReel(id);
    if (!reel) return fail("릴스를 찾을 수 없습니다", 404);
    const schedules = db().prepare("SELECT * FROM schedules WHERE reel_id=? ORDER BY publish_at DESC").all(id);
    const posts = db().prepare("SELECT * FROM instagram_posts WHERE reel_id=?").all(id);
    const jobs = db().prepare("SELECT id, phase, attempts, last_error, updated_at FROM publishing_jobs WHERE reel_id=? ORDER BY created_at DESC LIMIT 5").all(id);
    return ok({ reel, schedules, posts, publishingJobs: jobs });
  });
}

const PatchSchema = z.object({
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  status: z.enum(["기획", "제작중", "검수", "승인", "예약", "발행완료", "실패"]).optional(),
  planned_date: z.string().optional(),
  scenes: z.array(SceneSchema).optional(), // §46 장면 순서/삭제/자막/대본/시간 수정
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const reel = getReel(id);
    if (!reel) return fail("릴스를 찾을 수 없습니다", 404);
    const body = PatchSchema.parse(await req.json());
    const patch: Record<string, unknown> = {};
    if (body.caption !== undefined) patch.caption = body.caption;
    if (body.hashtags) patch.hashtags_json = JSON.stringify(body.hashtags);
    if (body.status) patch.status = body.status;
    if (body.planned_date) patch.planned_date = body.planned_date;

    if (body.scenes) {
      // 장면 번호 재정렬 + 시간 연속성 재계산
      let t = 0;
      const renumbered = body.scenes.map((s, i) => {
        const len = Math.max(1.2, s.end - s.start);
        const scene = { ...s, scene: i + 1, start: Math.round(t * 10) / 10, end: Math.round((t + len) * 10) / 10 };
        t += len;
        return scene;
      });
      saveScenes(id, renumbered);
      if (reel.script) {
        const script = { ...reel.script, scenes: renumbered, duration: Math.round(t) };
        patch.script_json = JSON.stringify(script);
        if (body.caption !== undefined) script.caption = body.caption;
      }
      patch.status = "검수"; // 수정하면 다시 검수 상태
    }
    updateReel(id, patch);
    return ok({ reel: getReel(id) });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    // 영상 파일은 지우지 않음(§43) — DB 기록만 삭제
    db().prepare("DELETE FROM reels WHERE id=?").run(id);
    return ok({ deleted: id });
  });
}
