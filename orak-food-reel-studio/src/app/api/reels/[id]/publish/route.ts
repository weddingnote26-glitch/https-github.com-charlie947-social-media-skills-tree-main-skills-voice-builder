import { handle, ok, fail } from "@/lib/api";
import { publishNow, tick } from "@/lib/scheduler";
import { getReel, reelFactcheck } from "@/lib/reels";
import { publishPreflight } from "@/lib/publish-check";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * §7 게시 직전 확인용 — 여기서는 아무것도 올리지 않는다.
 * 계정·토큰·검수·공개 주소·영상 형식을 하나씩 확인해 화면에 보여 준다.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getReel(id)) return fail("릴스를 찾을 수 없습니다", 404);
    return ok(await publishPreflight(id));
  });
}

const Body = z.object({
  /** 화면에서 [게시하기] 를 실제로 눌렀다는 표시 — 없으면 올리지 않는다 (§7) */
  confirmed: z.literal(true),
  /** 같은 요청이 두 번 들어와도 한 번만 올리기 위한 열쇠 (§6) */
  requestKey: z.string().min(8).max(64).optional(),
  /** 이미 올라간 릴스를 사용자가 일부러 다시 올리는 경우 */
  republish: z.boolean().optional(),
});

/** 지금 발행 — 최종 확인창에서 [게시하기] 를 누른 경우에만 여기까지 온다 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const reel = getReel(id);
    if (!reel) return fail("릴스를 찾을 수 없습니다", 404);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      // 실수로 호출되거나 예전 화면에서 눌러도 실제 게시가 나가지 않게 한다
      return fail("최종 확인 후에만 발행할 수 있습니다. 미리보기 화면에서 [게시하기] 를 눌러 주세요.");
    }
    if (reelFactcheck(reel).length === 0) return fail("팩트체크가 없는 콘텐츠는 발행할 수 없습니다");

    const pre = await publishPreflight(id);
    if (pre.alreadyPosted && !parsed.data.republish) {
      return fail(`이미 발행된 릴스입니다 (미디어 ID ${pre.alreadyPosted.mediaId}). 다시 올리시려면 [다시 게시] 를 골라 주세요.`);
    }
    if (!pre.canPublish) return fail(pre.blockers.join(" / "));

    const out = publishNow(id, parsed.data.requestKey);
    void tick(); // 즉시 한 번 진행
    return ok(out);
  });
}
