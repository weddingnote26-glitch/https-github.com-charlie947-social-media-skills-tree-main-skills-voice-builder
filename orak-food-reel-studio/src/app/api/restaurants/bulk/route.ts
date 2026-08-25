import { handle, ok, fail } from "@/lib/api";
import { db } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["trash", "restore"]),
  ids: z.array(z.string().min(1)).min(1).max(100),
});

/**
 * §13 맛집 DB 선택 삭제 — 소프트 삭제.
 * 연결된 완성 콘텐츠와 게시물은 그대로 둔다. 릴스의 factcheck_json 에
 * 업체명이 스냅샷으로 남아 있으므로 화면이 깨지지 않는다.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const d = db();
    let touched = 0;
    for (const id of body.ids) {
      const r = body.action === "trash"
        ? d.prepare("UPDATE restaurants SET deleted_at=datetime('now') WHERE id=? AND deleted_at IS NULL").run(id)
        : d.prepare("UPDATE restaurants SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL").run(id);
      if (r.changes) touched++;
    }
    if (!touched) return fail("바뀐 항목이 없습니다. 이미 처리됐거나 찾을 수 없습니다.");
    return ok({ action: body.action, touched });
  });
}
