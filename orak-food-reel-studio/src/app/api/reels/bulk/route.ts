import { handle, ok, fail } from "@/lib/api";
import { db } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["trash", "restore"]),
  ids: z.array(z.string().min(1)).min(1).max(100),
});

/**
 * §12 완성 콘텐츠 선택 삭제 — 소프트 삭제.
 *
 * 목록에서만 빠진다. 영상 파일 · 프로젝트 폴더 · Instagram 게시물은
 * 아무것도 지우지 않는다. 복원하면 그대로 돌아온다.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const d = db();
    let touched = 0;
    for (const id of body.ids) {
      if (body.action === "trash") {
        const r = d.prepare("UPDATE reels SET deleted_at=datetime('now') WHERE id=? AND deleted_at IS NULL").run(id);
        if (r.changes) {
          touched++;
          // 휴지통에 들어간 릴스의 대기 중 예약은 멈춘다 — 예약 시각에 발행되면 안 된다
          d.prepare("UPDATE schedules SET status='취소' WHERE reel_id=? AND status='예약'").run(id);
        }
      } else {
        const r = d.prepare("UPDATE reels SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL").run(id);
        if (r.changes) touched++;
      }
    }
    if (!touched) return fail("바뀐 항목이 없습니다. 이미 처리됐거나 찾을 수 없습니다.");
    return ok({ action: body.action, touched });
  });
}
