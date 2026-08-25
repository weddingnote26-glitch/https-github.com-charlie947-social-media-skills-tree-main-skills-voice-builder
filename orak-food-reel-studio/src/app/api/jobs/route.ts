import { handle, ok, fail } from "@/lib/api";
import { listJobs, deleteJobs, deleteJobsByStatus, countJobs } from "@/lib/pipeline/jobs";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** 작업 목록 — ?status=실패 로 거를 수 있다 */
export async function GET(req: Request) {
  return handle(() => {
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    return ok({
      jobs: listJobs(status),
      counts: { 실패: countJobs("실패"), 진행중: countJobs("진행중"), 완료: countJobs("완료") },
    });
  });
}

const DeleteBody = z.object({
  ids: z.array(z.string()).optional(),
  /** 특정 상태를 통째로 (예: 실패 목록 전체 삭제) */
  allWithStatus: z.enum(["실패", "완료", "대기", "취소"]).optional(),
});

/** 작업 기록 삭제 — 만들어진 릴스·영상 파일은 지우지 않는다 */
export async function DELETE(req: Request) {
  return handle(async () => {
    const body = DeleteBody.parse(await req.json());
    if (!body.ids?.length && !body.allWithStatus) {
      return fail("삭제할 작업을 선택해 주세요");
    }
    const removed = body.allWithStatus
      ? deleteJobsByStatus(body.allWithStatus)
      : deleteJobs(body.ids ?? []);
    return ok({
      removed,
      counts: { 실패: countJobs("실패"), 진행중: countJobs("진행중"), 완료: countJobs("완료") },
    });
  });
}
