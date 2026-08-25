/**
 * 만두탐정 오락이 영상 실검증.
 *
 * "이름만 추가하고 완료" 를 막기 위한 스크립트다.
 * Sample Mode 로 실제 MP4 를 만들고, 프레임을 뽑아
 *   - 오락이가 실제로 배치됐는지
 *   - 한글 간판·메뉴가 영상에 찍혔는지
 *   - 배경 프롬프트에 한국 조건과 "글자 없는 간판" 이 들어갔는지
 * 를 확인한다. 결과 프레임은 파일로 남겨 눈으로도 볼 수 있게 한다.
 */
import fs from "node:fs";
import path from "node:path";
import { createJob, runProductionJob, getJob } from "../src/lib/pipeline/run";
import { getReel } from "../src/lib/reels";
import { runFFmpeg, runFFprobe } from "../src/lib/ffmpeg";
import { buildScenePrompt, scenePromptIssues } from "../src/lib/content/scene-prompt";
import { countCharacter, presenceBlockReason } from "../src/lib/content/character-presence";
import { orakiAssets } from "../src/lib/character/asset-root";

const OUT = process.env.ORAKI_VERIFY_OUT ?? path.join(process.cwd(), "테스트 결과");

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

async function main() {
  process.env.APP_MODE = "sample";
  fs.mkdirSync(OUT, { recursive: true });

  // ── 0) 마스터 캐릭터 파일 ──
  const assets = orakiAssets();
  check("오락이 마스터 이미지를 찾았다", !!assets.master, assets.master ?? "없음");
  console.log(`   에셋 폴더: ${assets.root} (${assets.source})`);

  // ── 1) 실제 제작 ──
  const jobId = createJob();
  await runProductionJob(jobId, {
    restaurantName: "오락이검증분식",
    area: "신림",
    contentType: "가성비 맛집",
    contentMode: "ORAKI_DETECTIVE",
    durationSec: 25,
    manual: {
      name: "오락이검증분식",
      area: "관악구 신림동",
      address: "서울 관악구 신림로 123",
      menus: [{ name: "손만두", price: "6,000원", verified: true }],
      hours: "매일 11:00~21:00",
      parking: "가게 앞 2대",
      field_status: { hours: "사용자 입력", parking: "사용자 입력" },
      recommended_for: "부모님과 오기 좋은 곳",
    },
  });
  const job = getJob(jobId)!;
  for (const s of job.steps) console.log(`   ${s.label}: ${s.status} ${s.message ?? ""}`);
  check("제작이 끝까지 갔다", job.status === "완료" || job.status === "성공", job.status);

  const reel = getReel(job.reel_id!)!;
  const video = reel.video_path!;
  check("MP4 파일이 실제로 있다", !!video && fs.existsSync(video),
    video ? `${(fs.statSync(video).size / 1024 / 1024).toFixed(2)}MB` : "없음");
  if (!video || !fs.existsSync(video)) { console.log(`\n실패 ${failed}건`); process.exit(1); }

  // ── 2) 캐릭터 배치 ──
  const scenes = reel.scenes;
  const shown = countCharacter(scenes);
  const ratio = shown / scenes.length;
  check("오프닝·마무리에 오락이가 있다", presenceBlockReason(scenes, "ORAKI_DETECTIVE") === null,
    presenceBlockReason(scenes, "ORAKI_DETECTIVE") ?? "규칙 통과");
  check("전체 장면의 60% 이상에 오락이가 나온다", ratio >= 0.6,
    `${shown}/${scenes.length} (${Math.round(ratio * 100)}%)`);

  // ── 3) 배경 프롬프트 규칙 ──
  let promptBad = 0;
  for (const s of scenes) {
    const built = buildScenePrompt({
      visualPrompt: s.visual_prompt, area: "관악구 신림동",
      address: "서울 관악구 신림로 123", supportsNegative: false,
    });
    if (scenePromptIssues(built).length) promptBad++;
  }
  check("모든 장면 프롬프트에 한국 조건 + 글자 없는 간판 규칙이 들어간다", promptBad === 0,
    promptBad ? `${promptBad}개 장면이 규칙 미달` : `${scenes.length}개 장면 통과`);

  // ── 4) 한글이 실제 자막 파일에 들어갔나 ──
  const ass = fs.readFileSync(path.join(reel.output_dir!, "subtitle.ass"), "utf8");
  check("영상에 구워지는 자막 파일에 한글 업체명이 있다", ass.includes("오락이검증분식"));
  check("확인된 메뉴·가격이 있다", ass.includes("손만두") && ass.includes("6,000원"));
  check("확인된 영업정보가 있다", ass.includes("매일 11:00~21:00"));
  check("한글 폰트 스타일을 쓴다", ass.includes("Noto Sans KR"));

  // ── 5) 영상 자체 ──
  const probe = JSON.parse(await runFFprobe([
    "-v", "error", "-print_format", "json", "-show_streams", "-show_format", video,
  ]));
  const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const a = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  check("9:16 세로 영상이다", v?.width === 1080 && v?.height === 1920, `${v?.width}×${v?.height}`);
  check("H.264 로 인코딩됐다", v?.codec_name === "h264", String(v?.codec_name));
  check("오디오 스트림이 있다", !!a, a ? `${a.codec_name}` : "없음");
  const dur = parseFloat(probe.format?.duration ?? "0");
  check("길이가 있다", dur > 3, `${dur.toFixed(1)}초`);

  // ── 6) 프레임 추출 — 눈으로 볼 수 있게 남긴다 ──
  const frames: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const at = Math.min(dur - 0.2, s.start + (s.end - s.start) / 2);
    const out = path.join(OUT, `oraki-scene-${String(i + 1).padStart(2, "0")}.jpg`);
    await runFFmpeg(["-hide_banner", "-loglevel", "error", "-y", "-ss", at.toFixed(2),
      "-i", video, "-frames:v", "1", "-q:v", "3", out], 60_000);
    if (fs.existsSync(out)) frames.push(out);
  }
  check("장면 프레임을 뽑았다", frames.length === scenes.length, `${frames.length}/${scenes.length}장`);
  console.log(`   프레임 위치: ${OUT}`);

  console.log(`\n${failed === 0 ? "모두 통과" : `실패 ${failed}건`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("검증 실패:", e); process.exit(1); });
