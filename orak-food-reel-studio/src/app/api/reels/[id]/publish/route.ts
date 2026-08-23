import { handle, ok, fail } from "@/lib/api";
import { publishNow, tick } from "@/lib/scheduler";
import { getReel, reelFactcheck } from "@/lib/reels";
import { j } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 지금 발행 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const reel = getReel(id);
    if (!reel) return fail("릴스를 찾을 수 없습니다", 404);
    if (!reel.video_path) return fail("영상이 아직 없습니다");
    if (reelFactcheck(reel).length === 0) return fail("팩트체크가 없는 콘텐츠는 발행할 수 없습니다");
    const q = j<{ fact_blocked?: boolean; fact_block_reasons?: string[] }>(reel.quality_json, {});
    if (q.fact_blocked) return fail("팩트체크 확인 필요: " + (q.fact_block_reasons ?? []).join(" / "));
    const out = publishNow(id);
    void tick(); // 즉시 한 번 진행
    return ok(out);
  });
}
