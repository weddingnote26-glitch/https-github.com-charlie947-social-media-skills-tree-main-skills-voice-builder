import { handle, ok, fail } from "@/lib/api";
import { recommendTopics } from "@/lib/content/topics";

export const dynamic = "force-dynamic";

/** 4대 분류의 세부 주제 추천 — ?category=daily|town|hobby|brand (&area=) */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const category = url.searchParams.get("category") ?? "";
    const area = (url.searchParams.get("area") ?? "").trim() || undefined;
    try {
      return ok(await recommendTopics(category, area));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
}
