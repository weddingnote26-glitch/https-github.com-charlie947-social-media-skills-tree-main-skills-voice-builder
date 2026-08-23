import { handle, ok } from "@/lib/api";
import { scheduleReel } from "@/lib/scheduler";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = z.object({ publishAt: z.string().optional() }).parse(await req.json().catch(() => ({})));
    return ok(scheduleReel(id, body.publishAt));
  });
}
