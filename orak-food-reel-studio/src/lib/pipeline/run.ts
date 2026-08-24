import path from "node:path";
import fs from "node:fs";
import { db, j, nextCaseNumber } from "../db";
import { newId, slugify, todayISO, contentHash } from "../id";
import { reelOutputDir } from "../paths";
import { RestaurantInfoSchema, type ReelScript, type RestaurantInfo, type Scene, type ContentMode } from "../schema";
import { researchRestaurant, type ResearchInput } from "./research";
import { generateScript } from "./script";
import { runFactCheck } from "./factcheck";
import { scoreQuality, checkDuplicate } from "./quality";
import { generateSceneImages } from "./images";
import { generateVoice } from "./tts";
import { writeSubtitles } from "./subtitles";
import { renderReel } from "./render";
import { makeThumbnail, thumbnailLines } from "./thumbnail";
import { getSettings } from "../settings";
import { saveScenes, updateReel, getReel } from "../reels";
import { logError, logInfo } from "../log";
import { isSampleMode } from "../secrets";
import { redactError } from "../redact";
import { bugTag } from "../where";

/** §44 제작 진행 단계 */
export const STEP_DEFS = [
  { key: "research", label: "콘텐츠 조사" },
  { key: "script", label: "대본 생성" },
  { key: "factcheck", label: "팩트체크" },
  { key: "images", label: "이미지 생성" },
  { key: "voice", label: "음성 생성" },
  { key: "subtitles", label: "자막 생성" },
  { key: "render", label: "영상 렌더링" },
  { key: "thumbnail", label: "썸네일" },
  { key: "quality", label: "품질 점수" },
] as const;

export type StepKey = (typeof STEP_DEFS)[number]["key"];

export interface StepState {
  key: StepKey; label: string;
  status: "대기중" | "진행중" | "완료" | "실패" | "건너뜀";
  progress: number; // 0~100 — indeterminate 인 단계에서는 의미 없음
  message?: string;
  /**
   * 실제 진행률을 셀 수 없는 단계.
   * 외부 API 한 번 호출로 끝나는 단계는 "몇 % 됐는지" 알 방법이 없다.
   * 숫자를 지어내는 대신 이 표시를 켜고 화면에는 "처리 중"으로 보여준다.
   */
  indeterminate?: boolean;
}

export interface ProduceInput {
  restaurantName?: string;
  restaurantUrl?: string;
  area?: string;
  contentType?: string;    // "자동 추천" 가능
  contentMode?: ContentMode | "AUTO";
  durationSec?: number;
  plannedDate?: string;
  manual?: Partial<RestaurantInfo>;
  reelId?: string;         // 다시 만들기 시 기존 릴 재사용
}

function initSteps(): StepState[] {
  return STEP_DEFS.map((s) => ({ key: s.key, label: s.label, status: "대기중", progress: 0 }));
}

function saveJob(jobId: string, steps: StepState[], status: string, reelId?: string, error?: string): void {
  // production_jobs.reel_id 는 reels(id) 외래키다.
  // 대본 생성이 실패하면 reels 행이 아직 없으므로, 존재를 확인한 뒤에만 연결한다.
  // (확인 없이 넣으면 "FOREIGN KEY constraint failed" 로 실패 기록조차 남지 않는다)
  const linkId = reelId && db().prepare("SELECT 1 AS x FROM reels WHERE id=?").get(reelId) ? reelId : null;
  db().prepare(
    `UPDATE production_jobs SET steps_json=?, status=?, reel_id=COALESCE(?, reel_id), error=?, updated_at=datetime('now') WHERE id=?`
  ).run(JSON.stringify(steps), status, linkId, error ?? null, jobId);
}

export function getJob(jobId: string): { id: string; reel_id: string | null; steps: StepState[]; status: string; error: string | null } | null {
  const row = db().prepare("SELECT * FROM production_jobs WHERE id=?").get(jobId) as
    | { id: string; reel_id: string | null; steps_json: string; status: string; error: string | null } | undefined;
  if (!row) return null;
  return { id: row.id, reel_id: row.reel_id, steps: j<StepState[]>(row.steps_json, []), status: row.status, error: row.error };
}

/** 실행 중 작업 레지스트리 — 같은 릴 중복 제작 방지 */
const running = new Set<string>();

/** 제작 시작 — jobId 즉시 반환, 실제 작업은 백그라운드 진행 (§3 버튼 하나) */
export function startProduction(input: ProduceInput): { jobId: string } {
  const jobId = createJob();
  void runProductionJob(jobId, input).catch((e) => {
    logError("produce", `작업 실패: ${e instanceof Error ? e.message : e}`);
  });
  return { jobId };
}

export function createJob(): string {
  const jobId = newId("job");
  db().prepare("INSERT INTO production_jobs (id, steps_json, status) VALUES (?,?,?)")
    .run(jobId, JSON.stringify(initSteps()), "진행중");
  return jobId;
}

/** 주간 순차 제작 등에서 완료까지 기다릴 때 사용 */
export async function runProductionJob(jobId: string, input: ProduceInput): Promise<void> {
  const steps = initSteps();
  const mark = (key: StepKey, patch: Partial<StepState>, jobStatus = "진행중", reelId?: string) => {
    const st = steps.find((s) => s.key === key)!;
    Object.assign(st, patch);
    saveJob(jobId, steps, jobStatus, reelId);
  };

  let reelId = input.reelId ?? newId("reel");
  let imageNotice = "";
  if (running.has(reelId)) throw new Error("이 릴스는 이미 제작 중입니다.");
  running.add(reelId);
  try {
    // 1) 콘텐츠 조사
    mark("research", { status: "진행중", progress: 0, indeterminate: true });
    const research: ResearchInput = {
      name: input.restaurantName, url: input.restaurantUrl, area: input.area, manual: input.manual,
    };
    const { info, notice } = await researchRestaurant(research);
    const restaurantId = saveRestaurant(info);
    mark("research", { status: "완료", progress: 100, indeterminate: false, message: notice ?? `${info.name} (${info.area})` });

    // 2) 대본
    mark("script", { status: "진행중", progress: 0, indeterminate: true, message: "AI에게 대본을 요청했습니다 (최대 2분)" });
    const settings = getSettings();
    const duration = input.durationSec ?? settings.reelDurationSec;
    const mode: ContentMode = input.contentMode && input.contentMode !== "AUTO"
      ? input.contentMode
      : "ORAKI_DETECTIVE";
    const script = await generateScript(
      info,
      { contentType: input.contentType, contentMode: mode, duration },
      // 재시도 횟수는 알지만 "몇 % 남았는지"는 알 수 없다 — 문구로만 알린다
      (p) => mark("script", { indeterminate: true, message: p.message }),
    );
    const date = input.plannedDate ?? todayISO();
    const outDir = reelOutputDir(date, slugify(info.name));
    upsertReel(reelId, restaurantId, script, outDir, date);
    saveScenes(reelId, script.scenes);
    mark("script", { status: "완료", progress: 100, indeterminate: false, message: script.title }, "진행중", reelId);

    // 3) 팩트체크 (§26)
    mark("factcheck", { status: "진행중", progress: 0, indeterminate: true });
    const fact = runFactCheck(script, info);
    updateReel(reelId, { factcheck_json: JSON.stringify(fact.items) });
    mark("factcheck", {
      indeterminate: false,
      status: "완료", progress: 100,
      message: fact.blocked ? `⚠ 확인 필요 ${fact.blockReasons.length}건` : `확인 ${fact.items.filter((i) => i.status === "확인").length}/${fact.items.length}`,
    });

    // 4) 이미지 (§12, 실패한 장면만 재시도 §43)
    mark("images", { status: "진행중", progress: 0, indeterminate: false });
    const images = await generateSceneImages(reelId, script.scenes, path.join(outDir, "images"), (done, total, note) => {
      mark("images", { progress: Math.round((done / total) * 100), message: note ?? `${done}/${total} 장면` });
    });
    for (const img of images) {
      const sc = script.scenes.find((s) => s.scene === img.scene);
      if (sc) { sc.image_path = img.path; sc.image_hash = img.hash; }
    }
    saveScenes(reelId, script.scenes);
    // 실패해서 임시 이미지로 채운 장면이 있으면 제작은 계속하되 분명히 알린다
    const placeholders = images.filter((i) => i.placeholder);
    imageNotice = placeholders.length
      ? `${placeholders.length}장이 임시 이미지입니다 (${placeholders[0].reason ?? "생성 실패"}). 해당 장면은 나중에 [🖼 이미지만 다시]로 만들 수 있습니다.`
      : "";
    mark("images", {
      status: "완료", progress: 100, indeterminate: false,
      message: placeholders.length
        ? `${images.length}장 중 ⚠ 임시 ${placeholders.length}장 — ${placeholders[0].reason ?? "생성 실패"}`
        : `${images.length}장 (캐시 ${images.filter((i) => i.cached).length})`,
    });

    // 5) 음성 (§16) — 실제 음성 길이에 맞춰 장면 시간 재조정
    mark("voice", { status: "진행중", progress: 0, indeterminate: false });
    const voice = await generateVoice(script.scenes, outDir, (done, total) => {
      mark("voice", { progress: Math.round((done / total) * 100) });
    });
    script.scenes = voice.scenes as ReelScript["scenes"];
    script.duration = Math.round(voice.totalSec);
    saveScenes(reelId, script.scenes);
    mark("voice", { status: "완료", progress: 100, indeterminate: false, message: `${voice.totalSec}s` });

    // 6) 자막 (§18) — SRT + ASS, 엔딩 시그니처(§26 캐릭터)
    mark("subtitles", { status: "진행중", progress: 0, indeterminate: true });
    const highlightWords = [info.name, ...(info.menus[0]?.name ? [info.menus[0].name] : [])];
    const endBadge = script.content_mode === "ORAKI_DETECTIVE"
      ? { from: Math.max(0, voice.totalSec - 1.1), to: voice.totalSec, text: "사건 해결" }
      : undefined;
    const subs = writeSubtitles(script.scenes, outDir, highlightWords, endBadge);
    mark("subtitles", { status: "완료", progress: 100, indeterminate: false });

    // 7) 렌더 (§20)
    mark("render", { status: "진행중", progress: 0, indeterminate: true, message: "FFmpeg 렌더링 중" });
    const imageByScene = new Map(script.scenes.map((s) => [s.scene, s.image_path!] as const));
    const videoPath = path.join(outDir, "reel.mp4");
    const rendered = await renderReel({
      scenes: script.scenes, imageByScene, voicePath: voice.voicePath,
      assPath: subs.assPath, outPath: videoPath,
    });
    mark("render", { status: "완료", progress: 100, indeterminate: false, message: `${rendered.totalSec.toFixed(1)}s` });

    // 8) 썸네일 (§23)
    mark("thumbnail", { status: "진행중", progress: 0, indeterminate: true });
    const heroScene = script.scenes.find((s) => s.character_presence === "none") ?? script.scenes[Math.min(2, script.scenes.length - 1)];
    const thumbPath = path.join(outDir, "thumbnail.jpg");
    await makeThumbnail({
      baseImage: heroScene.image_path!,
      outPath: thumbPath,
      lines: thumbnailLines(script.hook, info.area),
      caseNumber: script.case_number,
    });
    mark("thumbnail", { status: "완료", progress: 100, indeterminate: false });

    // 9) 품질 점수 (§27) + 중복 (§28)
    mark("quality", { status: "진행중", progress: 0, indeterminate: true });
    const okCount = fact.items.filter((i) => i.status === "확인").length;
    const quality = scoreQuality(script, fact.blocked, okCount, fact.items.length);
    const dup = checkDuplicate(script, reelId);
    script.quality_score = quality.total;
    mark("quality", {
      indeterminate: false,
      status: "완료", progress: 100,
      message: `${quality.total}점${quality.pass ? "" : " (80점 미만 — 수정안 확인)"}${dup.tooSimilar ? " · 중복 주의" : ""}`,
    });

    // 파일 저장 (§37)
    writeOutputFiles(outDir, script, info);
    updateReel(reelId, {
      script_json: JSON.stringify(script),
      verdict_json: JSON.stringify(script.verdict ?? {}),
      caption: script.caption,
      hashtags_json: JSON.stringify(script.hashtags),
      quality_json: JSON.stringify({
        ...quality, duplicate: dup, fact_blocked: fact.blocked, fact_block_reasons: fact.blockReasons,
        image_notice: imageNotice,
      }),
      video_path: videoPath, thumb_path: thumbPath, srt_path: subs.srtPath, voice_path: voice.voicePath,
      duration_sec: rendered.totalSec,
      status: "검수",
      title: script.title,
    });
    saveJob(jobId, steps, "완료", reelId);
    logInfo("produce", `제작 완료 — ${script.title} (${reelId})`);

    // §33 AUTO MODE: 팩트체크 통과 + 품질 통과 시 자동 예약 (FACT CHECK 실패는 발행 금지)
    if (getSettings().approvalMode === "AUTO" && !fact.blocked && quality.pass && !isSampleMode()) {
      const { autoSchedule } = await import("../scheduler");
      autoSchedule(reelId);
    }
  } catch (e) {
    // 외부 API 오류 문구는 우리가 만든 게 아니다 — 화면·DB에 남기기 전에 비밀값을 지운다
    // 프로그램이 터진 경우에는 어느 파일 몇 번째 줄인지 짧게 붙인다.
    // 화면만 보고도 어디를 봐야 하는지 알 수 있어야 한다.
    const msg = redactError(e) + bugTag(e);
    const failing = steps.find((s) => s.status === "진행중");
    // 코드가 터진 경우(TypeError 등)는 화면 문구만으로는 어디가 문제인지 알 수 없다.
    // 어느 파일 몇 번째 줄인지 로그 파일에 남겨 둔다 — 화면에는 남기지 않는다.
    logError("produce", `${failing?.label ?? "제작"} 단계 실패 — ${msg}`, {
      step: failing?.key,
      kind: e instanceof Error ? e.name : typeof e,
      stack: e instanceof Error && e.stack ? e.stack.split("\n").slice(0, 8).join(" | ") : undefined,
    });
    if (failing) Object.assign(failing, { status: "실패", message: msg.slice(0, 300) });
    saveJob(jobId, steps, "실패", reelId, msg.slice(0, 500));
    if (db().prepare("SELECT 1 AS x FROM reels WHERE id=?").get(reelId)) {
      updateReel(reelId, { status: "실패" });
    }
    throw e;
  } finally {
    running.delete(reelId);
  }
}

function saveRestaurant(info: RestaurantInfo): string {
  const d = db();
  const existing = d.prepare("SELECT id FROM restaurants WHERE name=? AND area=?").get(info.name, info.area) as { id: string } | undefined;
  const id = existing?.id ?? newId("rest");
  const params = {
    id, name: info.name, area: info.area, address: info.address, phone: info.phone,
    map_url: info.map_url, source_url: info.source_url,
    menus_json: JSON.stringify(info.menus), hours: info.hours, closed_days: info.closed_days,
    parking: info.parking, reservation: info.reservation,
    features_json: JSON.stringify(info.features), review_summary: info.review_summary,
    pros_json: JSON.stringify(info.pros), cons_json: JSON.stringify(info.cons),
    recommended_for: info.recommended_for, field_status_json: JSON.stringify(info.field_status),
  };
  d.prepare(`INSERT INTO restaurants (id,name,area,address,phone,map_url,source_url,menus_json,hours,closed_days,parking,reservation,features_json,review_summary,pros_json,cons_json,recommended_for,field_status_json)
    VALUES (@id,@name,@area,@address,@phone,@map_url,@source_url,@menus_json,@hours,@closed_days,@parking,@reservation,@features_json,@review_summary,@pros_json,@cons_json,@recommended_for,@field_status_json)
    ON CONFLICT(id) DO UPDATE SET address=@address, phone=@phone, map_url=@map_url, source_url=@source_url,
    menus_json=@menus_json, hours=@hours, closed_days=@closed_days, parking=@parking, reservation=@reservation,
    features_json=@features_json, review_summary=@review_summary, pros_json=@pros_json, cons_json=@cons_json,
    recommended_for=@recommended_for, field_status_json=@field_status_json, updated_at=datetime('now')`).run(params);
  return id;
}

function upsertReel(reelId: string, restaurantId: string, script: ReelScript, outDir: string, date: string): void {
  const d = db();
  const exists = d.prepare("SELECT id FROM reels WHERE id=?").get(reelId);
  if (exists) {
    updateReel(reelId, {
      restaurant_id: restaurantId, title: script.title, content_mode: script.content_mode,
      content_type: script.content_type, case_number: script.case_number ?? null,
      case_title: script.case_title ?? null, script_json: JSON.stringify(script),
      output_dir: outDir, status: "제작중", planned_date: date,
    });
  } else {
    d.prepare(`INSERT INTO reels (id, restaurant_id, case_number, case_title, content_mode, content_type, title, script_json, output_dir, status, planned_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(reelId, restaurantId, script.case_number ?? null, script.case_title ?? null,
        script.content_mode, script.content_type, script.title, JSON.stringify(script), outDir, "제작중", date);
  }
}

/** §37 콘텐츠별 산출물 저장 */
function writeOutputFiles(outDir: string, script: ReelScript, info: RestaurantInfo): void {
  fs.writeFileSync(path.join(outDir, "script.json"), JSON.stringify(script, null, 2), "utf8");
  fs.writeFileSync(
    path.join(outDir, "script.txt"),
    script.scenes.map((s) => `SCENE ${s.scene} [${s.start}~${s.end}s]\n나레이션: ${s.narration}\n자막: ${s.subtitle}\n`).join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(outDir, "caption.txt"), script.caption, "utf8");
  fs.writeFileSync(path.join(outDir, "hashtags.txt"), script.hashtags.join(" "), "utf8");
  fs.writeFileSync(path.join(outDir, "metadata.json"), JSON.stringify({
    restaurant: info, generated_at: new Date().toISOString(),
    content_mode: script.content_mode, content_type: script.content_type,
    case_number: script.case_number, quality_score: script.quality_score,
  }, null, 2), "utf8");
}

/** §45 SCENE 단위 재생성 — 이미지/음성/대본 일부만 다시 */
export async function regenerateScene(reelId: string, sceneNo: number, what: "image" | "voice" | "subtitle"): Promise<void> {
  const reel = getReel(reelId);
  if (!reel || !reel.script || !reel.output_dir) throw new Error("릴스를 찾을 수 없습니다");
  const script = reel.script;
  // DB 장면 최신값을 대본에 반영 (사용자 수정분)
  for (const s of script.scenes) {
    const dbScene = reel.scenes.find((x) => x.scene === s.scene);
    if (dbScene) Object.assign(s, dbScene);
  }
  const outDir = reel.output_dir;

  if (what === "image") {
    const target = script.scenes.find((s) => s.scene === sceneNo);
    if (target) { target.image_hash = null; } // 캐시 무효화
    const images = await generateSceneImages(reelId, script.scenes, path.join(outDir, "images"), undefined, [sceneNo]);
    for (const img of images) {
      const sc = script.scenes.find((s) => s.scene === img.scene);
      if (sc) { sc.image_path = img.path; sc.image_hash = img.hash; }
    }
  }
  if (what === "voice" || what === "image" || what === "subtitle") {
    // 음성은 전체 타이밍에 영향 → voice 재생성 시 전체 트랙 재합성
    if (what === "voice") {
      const voice = await generateVoice(script.scenes, outDir);
      script.scenes = voice.scenes as ReelScript["scenes"];
      script.duration = Math.round(voice.totalSec);
      updateReel(reelId, { voice_path: voice.voicePath });
    }
    let highlightName = script.restaurant;
    try { if (reel.restaurant_id) highlightName = restaurantInfoOf(reel.restaurant_id).name; } catch { /* 이름만 사용 */ }
    const endBadge = script.content_mode === "ORAKI_DETECTIVE"
      ? { from: Math.max(0, script.scenes[script.scenes.length - 1].end - 1.1), to: script.scenes[script.scenes.length - 1].end, text: "사건 해결" }
      : undefined;
    writeSubtitles(script.scenes, outDir, [highlightName], endBadge);
  }
  saveScenes(reelId, script.scenes);
  updateReel(reelId, { script_json: JSON.stringify(script), status: "검수" });
}

export function restaurantInfoOf(restaurantId: string): RestaurantInfo {
  const r = db().prepare("SELECT * FROM restaurants WHERE id=?").get(restaurantId) as Record<string, string> | undefined;
  if (!r) throw new Error("맛집을 찾을 수 없습니다");
  return RestaurantInfoSchema.parse({
    name: r.name, area: r.area, address: r.address ?? "", phone: r.phone ?? "",
    map_url: r.map_url ?? "", source_url: r.source_url ?? "",
    menus: j(r.menus_json, []), hours: r.hours ?? "", closed_days: r.closed_days ?? "",
    parking: r.parking ?? "", reservation: r.reservation ?? "",
    features: j(r.features_json, []), review_summary: r.review_summary ?? "",
    pros: j(r.pros_json, []), cons: j(r.cons_json, []),
    recommended_for: r.recommended_for ?? "", field_status: j(r.field_status_json, {}),
  });
}

/** 렌더만 다시 (장면 수정 후) */
export async function rerender(reelId: string): Promise<void> {
  const reel = getReel(reelId);
  if (!reel || !reel.script || !reel.output_dir) throw new Error("릴스를 찾을 수 없습니다");
  const script = reel.script;
  const voicePath = reel.voice_path ?? path.join(reel.output_dir, "voice.mp3");
  if (!fs.existsSync(voicePath)) throw new Error("음성 파일이 없습니다 — 음성부터 다시 생성하세요");
  const assPath = path.join(reel.output_dir, "subtitle.ass");
  const imageByScene = new Map(script.scenes.map((s) => [s.scene, s.image_path!] as const));
  const videoPath = path.join(reel.output_dir, "reel.mp4");
  const rendered = await renderReel({ scenes: script.scenes, imageByScene, voicePath, assPath, outPath: videoPath });
  updateReel(reelId, { video_path: videoPath, duration_sec: rendered.totalSec, status: "검수" });
}
