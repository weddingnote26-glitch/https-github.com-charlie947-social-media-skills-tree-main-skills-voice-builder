/** Next.js 기동 시 1회 실행 — 폴더 준비, 유령 작업 정리, 스케줄러 시작 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureDirs } = await import("./lib/paths");
  const { startScheduler } = await import("./lib/scheduler");
  const { db } = await import("./lib/db");
  const { logInfo } = await import("./lib/log");

  ensureDirs();

  /**
   * 서버가 꺼지면 진행 중이던 제작은 그 자리에서 죽는다.
   * 그런데 DB에는 "진행중"으로 남아, 다시 켰을 때 영원히 도는 유령 작업처럼 보인다.
   * 기동 시 한 번 정리해서 사용자가 상태를 오해하지 않게 한다.
   */
  const stale = db().prepare(
    "SELECT COUNT(*) AS c FROM production_jobs WHERE status='진행중'"
  ).get() as { c: number };
  if (stale.c > 0) {
    db().prepare(
      `UPDATE production_jobs
         SET status='실패',
             error=COALESCE(NULLIF(error,''), '서버가 다시 시작되어 중단되었습니다. 다시 만들기를 눌러 주세요.'),
             updated_at=datetime('now')
       WHERE status='진행중'`
    ).run();
    db().prepare("UPDATE reels SET status='실패' WHERE status='제작중'").run();
    logInfo("startup", `중단된 제작 ${stale.c}건을 정리했습니다`);
  }

  startScheduler();
}
