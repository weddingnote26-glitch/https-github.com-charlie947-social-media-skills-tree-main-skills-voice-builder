import { handle, ok, fail } from "@/lib/api";
import { getJob } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  return handle(async () => {
    const { jobId } = await ctx.params;
    const job = getJob(jobId);
    if (!job) return fail("작업을 찾을 수 없습니다", 404);
    return ok(job);
  });
}
