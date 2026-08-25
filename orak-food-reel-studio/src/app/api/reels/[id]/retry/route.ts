import { handle, ok } from "@/lib/api";
import { retryPublish, tick } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const out = retryPublish(id);
    void tick();
    return ok(out);
  });
}
