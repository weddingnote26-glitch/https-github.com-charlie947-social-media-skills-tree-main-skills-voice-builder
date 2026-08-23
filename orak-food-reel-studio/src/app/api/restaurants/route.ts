import { handle, ok, fail } from "@/lib/api";
import { db } from "@/lib/db";
import { researchRestaurant } from "@/lib/pipeline/research";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => ok({
    restaurants: db().prepare("SELECT * FROM restaurants ORDER BY updated_at DESC LIMIT 200").all(),
  }));
}

/** URL/이름으로 맛집 조사만 미리 실행 (§5~6) */
export async function POST(req: Request) {
  return handle(async () => {
    const body = z.object({ name: z.string().optional(), url: z.string().optional(), area: z.string().optional() })
      .parse(await req.json());
    if (!body.name && !body.url) return fail("맛집명 또는 URL이 필요합니다");
    const { info, notice } = await researchRestaurant(body);
    return ok({ info, notice });
  });
}
