import { handle, ok, fail } from "@/lib/api";
import { regenerateScene } from "@/lib/pipeline/run";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** §45 SCENE 단위 재생성 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = z.object({
      scene: z.number().int().min(1),
      what: z.enum(["image", "voice", "subtitle"]),
    }).safeParse(await req.json());
    if (!body.success) return fail("scene 번호와 what(image|voice|subtitle)이 필요합니다");
    await regenerateScene(id, body.data.scene, body.data.what);
    return ok({ done: true });
  });
}
