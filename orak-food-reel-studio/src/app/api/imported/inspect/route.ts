import { handle, ok, fail } from "@/lib/api";
import { inspectVideo } from "@/lib/pipeline/imported-video";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** 고른 파일이 정말 영상인지 (확장자가 아니라 FFprobe 로) 확인하고 요약을 돌려준다 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = z.object({ sourcePath: z.string().min(1) }).safeParse(await req.json().catch(() => ({})));
    if (!body.success) return fail("영상 파일 경로가 필요합니다");
    try {
      return ok({ info: await inspectVideo(body.data.sourcePath) });
    } catch (e) {
      // 무엇이 문제인지는 사용자 잘못(파일 선택)인 경우가 대부분이라 400 으로 알린다
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
}
