/** Next.js 기동 시 1회 실행 — 폴더 준비, 유령 작업 정리, 스케줄러 시작 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureDirs } = await import("./lib/paths");
  const { startScheduler } = await import("./lib/scheduler");
  const { db } = await import("./lib/db");
  const { logInfo } = await import("./lib/log");

  ensureDirs();

  /**
   * 어떤 빌드가, 어느 자리에서, 어느 포트로 도는지 로그 첫 줄에 남긴다.
   *
   * 설치본에서 화면이 멈췄을 때 "지금 도는 게 새 빌드가 맞는지"와
   * "브라우저로 직접 열어 보려면 몇 번 포트인지"를 알 방법이 없었다.
   * 이 한 줄이면 로그 파일만 보고 둘 다 알 수 있다.
   */
  logInfo("startup", [
    `빌드 ${process.env.ORAK_BUILD || "(알 수 없음)"}`,
    `포트 ${process.env.PORT || "3000"}`,
    `자료 폴더 ${process.env.ORAK_HOME || "(프로그램 폴더)"}`,
    `Node ${process.version}`,
  ].join(" · "));

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

  // 외부 영상 AI 음성 작업(imported_video_jobs)도 같은 이유로 정리한다
  const { cleanupStaleImportedJobs } = await import("./lib/pipeline/imported-video");
  const staleImported = cleanupStaleImportedJobs();
  if (staleImported > 0) logInfo("startup", `중단된 외부 영상 작업 ${staleImported}건을 정리했습니다`);

  startScheduler();
}
