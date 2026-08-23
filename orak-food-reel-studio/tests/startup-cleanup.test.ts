import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("startup");
import { db } from "../src/lib/db";

/** instrumentation 의 정리 로직과 동일한 SQL — 서버 재기동 시 유령 작업 제거 */
function cleanupStaleJobs(): number {
  const stale = db().prepare("SELECT COUNT(*) AS c FROM production_jobs WHERE status='진행중'").get() as { c: number };
  if (stale.c > 0) {
    db().prepare(
      `UPDATE production_jobs
         SET status='실패',
             error=COALESCE(NULLIF(error,''), '서버가 다시 시작되어 중단되었습니다. 다시 만들기를 눌러 주세요.'),
             updated_at=datetime('now')
       WHERE status='진행중'`
    ).run();
    db().prepare("UPDATE reels SET status='실패' WHERE status='제작중'").run();
  }
  return stale.c;
}

describe("서버 재시작 시 유령 작업 정리", () => {
  it("진행중으로 남은 작업을 실패로 바꾸고 사유를 남긴다", () => {
    db().prepare("INSERT INTO production_jobs (id, steps_json, status) VALUES ('j1','[]','진행중')").run();
    db().prepare("INSERT INTO production_jobs (id, steps_json, status) VALUES ('j2','[]','진행중')").run();
    db().prepare("INSERT INTO production_jobs (id, steps_json, status) VALUES ('j3','[]','완료')").run();
    db().prepare("INSERT INTO reels (id, title, status, script_json, factcheck_json, quality_json) VALUES ('r1','x','제작중','{}','[]','{}')").run();

    expect(cleanupStaleJobs()).toBe(2);

    const rows = db().prepare("SELECT id, status, error FROM production_jobs ORDER BY id").all() as Array<{ id: string; status: string; error: string | null }>;
    expect(rows.find((r) => r.id === "j1")!.status).toBe("실패");
    expect(rows.find((r) => r.id === "j1")!.error).toContain("서버가 다시 시작되어");
    expect(rows.find((r) => r.id === "j2")!.status).toBe("실패");
    // 이미 끝난 작업은 건드리지 않는다
    expect(rows.find((r) => r.id === "j3")!.status).toBe("완료");

    const reel = db().prepare("SELECT status FROM reels WHERE id='r1'").get() as { status: string };
    expect(reel.status).toBe("실패");
  });

  it("정리할 게 없으면 아무것도 바꾸지 않는다", () => {
    expect(cleanupStaleJobs()).toBe(0);
  });
});
