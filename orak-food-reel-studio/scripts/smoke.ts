/** Sample Mode 전체 파이프라인 스모크 테스트 — 실제 MP4가 나와야 통과 */
import { createJob, runProductionJob, getJob } from "../src/lib/pipeline/run";
import { getReel } from "../src/lib/reels";
import fs from "node:fs";

async function main() {
  process.env.APP_MODE = "sample";
  const jobId = createJob();
  await runProductionJob(jobId, {
    restaurantName: "신림골목만두",
    area: "신림",
    contentType: "가성비 맛집",
    contentMode: "ORAKI_DETECTIVE",
    durationSec: 25,
    manual: {
      name: "신림골목만두",
      area: "신림",
      address: "서울 관악구 신림동 000-00",
      menus: [{ name: "고기만두", price: "6,000원", verified: true }],
      recommended_for: "혼밥·가성비를 찾는 분",
    },
  });
  const job = getJob(jobId)!;
  console.log("JOB:", job.status);
  for (const s of job.steps) console.log(` - ${s.label}: ${s.status} ${s.message ?? ""}`);
  const reel = getReel(job.reel_id!)!;
  console.log("REEL:", reel.title, "| status:", reel.status, "| dur:", reel.duration_sec);
  console.log("video:", reel.video_path, fs.existsSync(reel.video_path!) ? `(${(fs.statSync(reel.video_path!).size / 1024 / 1024).toFixed(1)}MB)` : "(없음!)");
  console.log("thumb:", fs.existsSync(reel.thumb_path!) ? "OK" : "없음");
  console.log("srt:", fs.existsSync(reel.srt_path!) ? "OK" : "없음");
  const q = JSON.parse(reel.quality_json);
  console.log("quality:", q.total, "pass:", q.pass);
  if (!fs.existsSync(reel.video_path!)) process.exit(1);
}
main().catch((e) => { console.error("SMOKE FAIL:", e); process.exit(1); });
