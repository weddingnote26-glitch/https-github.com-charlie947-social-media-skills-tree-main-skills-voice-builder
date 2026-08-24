import { handle, ok, fail } from "@/lib/api";
import { regenerateScene } from "@/lib/pipeline/run";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** §45 SCENE 단위 재생성 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = z.object({
      // scene 을 비우고 what:"image" 를 보내면 이미지 전체를 다시 만든다
      scene: z.number().int().min(1).optional(),
      what: z.enum(["image", "voice", "subtitle"]),
    }).safeParse(await req.json());
    if (!body.success) return fail("what(image|voice|subtitle)이 필요합니다. scene 을 비우면 이미지 전체를 다시 만듭니다.");
    await regenerateScene(id, body.data.scene ?? null, body.data.what);
    return ok({ done: true });
  });
}
