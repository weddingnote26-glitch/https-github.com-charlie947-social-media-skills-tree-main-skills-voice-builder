/** Next.js 기동 시 1회 실행 — 폴더 준비 + 스케줄러 시작 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDirs } = await import("./lib/paths");
    const { startScheduler } = await import("./lib/scheduler");
    ensureDirs();
    startScheduler();
  }
}
