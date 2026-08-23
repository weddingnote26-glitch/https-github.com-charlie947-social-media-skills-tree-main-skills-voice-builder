import { handle, ok, fail } from "@/lib/api";
import { startProduction, type ProduceInput } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json() as ProduceInput;
    if (!body.restaurantName?.trim() && !body.restaurantUrl?.trim() && !body.reelId) {
      return fail("맛집명 또는 맛집 URL 중 하나는 입력해야 합니다");
    }
    const { jobId } = startProduction(body);
    return ok({ jobId });
  });
}
