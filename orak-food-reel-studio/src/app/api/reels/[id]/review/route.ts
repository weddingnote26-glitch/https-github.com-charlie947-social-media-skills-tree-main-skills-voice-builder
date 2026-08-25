import { handle, ok, fail } from "@/lib/api";
import { getReel } from "@/lib/reels";
import { getReview, saveReview, publishBlockReason, REVIEW_ITEMS, type ReviewKey } from "@/lib/review";
import { videoInfo, fileNameOf } from "@/lib/video-info";
import { restaurantForm } from "@/lib/restaurants";
import { j } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** §5 미리보기·검수 화면이 쓰는 모든 값 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const reel = getReel(id);
    if (!reel) return fail("릴스를 찾을 수 없습니다", 404);

    const video = await videoInfo(reel.video_path, reel.srt_path);
    return ok({
      reel: {
        id: reel.id, title: reel.title, status: reel.status,
        caption: reel.caption, hashtags: j<string[]>(reel.hashtags_json, []),
        video_path: reel.video_path, thumb_path: reel.thumb_path,
        planned_date: reel.planned_date,
        // 전체 경로에는 사용자 이름이 들어 있다 — 파일 이름만 보여 준다
        videoFile: fileNameOf(reel.video_path),
        voiceFile: fileNameOf(reel.voice_path),
        srtFile: fileNameOf(reel.srt_path),
      },
      scenes: reel.scenes.map((s) => ({
        scene: s.scene, subtitle: s.subtitle, image_path: s.image_path, fact_source: s.fact_source,
      })),
      video,
      facts: j(reel.factcheck_json, []),
      quality: j(reel.quality_json, {}),
      restaurant: restaurantForm(reel.restaurant_id),
      review: getReview(id),
      items: REVIEW_ITEMS,
      blockReason: publishBlockReason(id),
    });
  });
}

const Schema = z.object({ checks: z.record(z.string(), z.boolean()) });

/** 검수 체크 저장 — 다섯 항목을 다 확인해야 발행 단추가 열린다 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getReel(id)) return fail("릴스를 찾을 수 없습니다", 404);
    const body = Schema.parse(await req.json());
    const known = new Set<string>(REVIEW_ITEMS.map((i) => i.key));
    const checks: Partial<Record<ReviewKey, boolean>> = {};
    for (const [k, v] of Object.entries(body.checks)) {
      if (known.has(k) && v) checks[k as ReviewKey] = true;
    }
    const review = saveReview(id, checks);
    return ok({ review, blockReason: publishBlockReason(id) });
  });
}
