import { handle, ok, fail } from "@/lib/api";
import { getImportedJob } from "@/lib/pipeline/imported-video";

export const dynamic = "force-dynamic";

/** 외부 영상 작업 하나의 진행 상황 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const job = getImportedJob(id);
    if (!job) return fail("작업을 찾을 수 없습니다", 404);
    return ok(job);
  });
}
