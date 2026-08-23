import { handle, ok } from "@/lib/api";
import { rerender } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    await rerender(id);
    return ok({ done: true });
  });
}
