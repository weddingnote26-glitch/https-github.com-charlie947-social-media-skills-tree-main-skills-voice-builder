import { handle, ok } from "@/lib/api";
import { analyzeRestaurantUrl } from "@/lib/url-analyze";
import { redact } from "@/lib/redact";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * §9 식당 URL 자동 분석 — 공개 페이지에 적힌 값만 꺼내 폼에 제안한다.
 * 확정은 사람이 한다. 키·토큰은 요청에도 응답에도 싣지 않는다.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { url } = z.object({ url: z.string().min(8).max(2000) }).parse(await req.json());
    try {
      return ok(await analyzeRestaurantUrl(url));
    } catch (e) {
      // 실패 이유를 사람이 읽는 문장으로 — 원문에 비밀값이 섞여도 걸러 낸다
      const msg = redact(e instanceof Error ? e.message : String(e));
      return ok({ url, fields: {}, notice: `식당 정보를 자동으로 확인하지 못했습니다. ${msg}` });
    }
  });
}
