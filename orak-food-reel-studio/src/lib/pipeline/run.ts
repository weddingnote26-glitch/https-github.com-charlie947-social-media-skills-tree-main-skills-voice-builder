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
import { generateSceneImages, lastImageUsage } from "./images";
import { sceneKindOf } from "../providers/image-quality";
import { generateVoice } from "./tts";
import { writeSubtitles } from "./subtitles";
import { buildOverlays } from "./overlay";
import { ensureCharacterPresence } from "../content/character-presence";
import { planCharacterOverlays } from "./character-overlay";
import { renderReel } from "./render";
import { makeThumbnail, thumbnailLines } from "./thumbnail";
import { getSettings } from "../settings";
import { saveScenes, updateReel, getReel } from "../reels";
import { findByName } from "../restaurants";
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
  /** 맛집 DB 에서 고른 업체 — 주면 조사 없이 이 업체를 그대로 쓴다.
      이름을 조금 다르게 칠 때마다 새 업체가 생기고, 수기 입력이
      그 릴스에 반영되지 않던 문제의 뿌리를 여기서 자른다. */
  restaurantId?: string;
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
    let info: RestaurantInfo;
    let notice: string | undefined;
    let restaurantId: string;
    if (input.restaurantId) {
      // 맛집 DB 에서 고른 업체 — 저장된 정보(수기 입력 포함)를 그대로 쓴다
      info = restaurantInfoOf(input.restaurantId);
      restaurantId = input.restaurantId;
      notice = undefined;
    } else {
      const research: ResearchInput = {
        name: input.restaurantName, url: input.restaurantUrl, area: input.area, manual: input.manual,
      };
      ({ info, notice } = await researchRestaurant(research));
      restaurantId = saveRestaurant(info);
    }
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
    /* 오락이 콘셉트인데 캐릭터가 장면에서 빠지는 일이 있었다 (광고 내레이션처럼 나옴).
       AI 가 매번 잘 넣어 주기를 기대하지 않고 여기서 규칙으로 채운다:
       오프닝·마무리는 필수, 전체의 60% 이상. */
    if (mode === "ORAKI_DETECTIVE") {
      const presence = ensureCharacterPresence(script.scenes, "most", 0.6);
      script.scenes = presence.scenes;
      if (presence.filled.length) {
        logInfo("script", `오락이 등장 규칙 적용 — ${presence.summary}`);
      }
    }
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
      /* 사장님이 직접 적어 넣은 값("사용자 입력")도 확인된 정보다.
         이걸 안 세서, 업체 정보를 다 채워 넣고도 "확인 0/7" 로 보였다. */
      message: fact.blocked
        ? `⚠ 확인 필요 ${fact.blockReasons.length}건`
        : `확인 ${fact.items.filter((i) => i.status === "확인" || i.status === "사용자 입력").length}/${fact.items.length}`,
    });

    // 4) 이미지 (§12, 실패한 장면만 재시도 §43)
    mark("images", { status: "진행중", progress: 0, indeterminate: false });
    const images = await generateSceneImages(reelId, script.scenes, path.join(outDir, "images"), (done, total, note) => {
      mark("images", { progress: Math.round((done / total) * 100), message: note ?? `${done}/${total} 장면` });
    }, undefined, { area: info.area, address: info.address });
    for (const img of images) {
      const sc = script.scenes.find((s) => s.scene === img.scene);
      if (sc) { sc.image_path = img.path; sc.image_hash = img.hash; }
    }
    saveScenes(reelId, script.scenes);
    // 실패해서 임시 이미지로 채운 장면이 있으면 제작은 계속하되 분명히 알린다
    const placeholders = images.filter((i) => i.placeholder);
    imageNotice = placeholders.length
      ? `${placeholders.length}장이 임시 이미지입니다. ${placeholders[0].reason?.trim() || "이미지 생성 한도 또는 설정 문제로 임시 이미지가 사용되었습니다."} 해당 장면은 [🖼 이미지 전체 다시]로 다시 만들 수 있습니다.`
      : "";
    // 사용량을 사람 말로 — 새로 만든 것/재사용/호출 수를 보여줘야 아끼는 게 눈에 보인다
    const u = lastImageUsage.value;
    const usageLine = u
      ? `신규 ${u.created} · 재사용 ${u.reused} · 호출 ${u.apiCalls}회${u.retries ? ` · 재시도 ${u.retries}` : ""}${u.budgetHit ? ` · ⚠ 상한 ${u.budget}회 도달` : ""}`
      : `${images.length}장 (캐시 ${images.filter((i) => i.cached).length})`;
    mark("images", {
      status: "완료", progress: 100, indeterminate: false,
      message: placeholders.length
        ? `${usageLine} · ⚠ 임시 ${placeholders.length}장 — ${placeholders[0].reason ?? "생성 실패"}`
        : usageLine,
    });

    // 5) 음성 (§16) — 실제 음성 길이에 맞춰 장면 시간 재조정
    mark("voice", { status: "진행중", progress: 0, indeterminate: false });
    /**
     * 음성 생성이 실패해도 영상은 만든다.
     *
     * 실제로 겪은 일: ElevenLabs 402(무료 사용량) 하나로 릴스 전체가 실패해
     * MP4 가 아예 나오지 않았다. 음성은 빠질 수 있는 재료다 —
     * 실패하면 무음 + 자막으로 계속 가고, 무엇이 왜 빠졌는지 화면에 남긴다.
     */
    let voicePath: string | null = null;
    let voiceNotice: string | null = null;
    try {
      const voice = await generateVoice(script.scenes, outDir, (done, total) => {
        mark("voice", { progress: Math.round((done / total) * 100) });
      });
      script.scenes = voice.scenes as ReelScript["scenes"];
      script.duration = Math.round(voice.totalSec);
      voicePath = voice.voicePath;
      /* 음성 길이에 맞춰 장면 시간이 바뀌었다 — 이걸 저장해 두지 않으면
         [다시 만들기] 가 옛 시간(대본이 요청한 길이)으로 렌더해 나레이션 끝이 잘린다.
         실제로 29.5초 음성이 25초 영상으로 다시 만들어져 4.5초가 사라졌다. */
      saveScenes(reelId, script.scenes);
      mark("voice", { status: "완료", progress: 100, indeterminate: false, message: `${voice.totalSec}s` });
    } catch (e) {
      voiceNotice = redactError(e);
      logError("voice", `음성 실패 — 무음으로 계속: ${voiceNotice}`);
      mark("voice", {
        status: "실패", progress: 100, indeterminate: false,
        message: `⚠ 음성 없이 계속 만듭니다 — ${voiceNotice.slice(0, 160)}`,
      });
    }
    const voice = {
      voicePath,
      totalSec: script.scenes[script.scenes.length - 1].end,
      scenes: script.scenes,
    };

    // 6) 자막 (§18) — SRT + ASS, 엔딩 시그니처(§26 캐릭터)
    mark("subtitles", { status: "진행중", progress: 0, indeterminate: true });
    const highlightWords = [info.name, ...(info.menus[0]?.name ? [info.menus[0].name] : [])];
    const endBadge = script.content_mode === "ORAKI_DETECTIVE"
      ? { from: Math.max(0, voice.totalSec - 1.1), to: voice.totalSec, text: "사건 해결" }
      : undefined;
    /* 한글 간판·메뉴판·정보판을 프로그램이 얹는다 (§한글 합성).
       AI 가 그린 글자는 깨지므로 배경은 글자 없이 만들고 여기서 정확한 한글을 올린다.
       확인 안 된 값은 buildOverlays 가 걸러 낸다 — 가격을 지어내지 않는다. */
    const overlays = buildOverlays(script.scenes, info, {
      checkedOn: new Date().toISOString().slice(0, 10),
      brandLine: script.content_mode === "ORAKI_DETECTIVE" ? "만두탐정 오락이의 맛집 조사" : undefined,
    });
    const subs = writeSubtitles(script.scenes, outDir, highlightWords, endBadge, overlays);
    mark("subtitles", { status: "완료", progress: 100, indeterminate: false });

    // 7) 렌더 (§20)
    mark("render", { status: "진행중", progress: 0, indeterminate: true, message: "FFmpeg 렌더링 중" });
    const imageByScene = new Map(script.scenes.map((s) => [s.scene, s.image_path!] as const));
    const videoPath = path.join(outDir, "reel.mp4");
    /* 오락이를 영상에 직접 얹는다. 이미지 AI 가 캐릭터를 빼먹어도 여기서 넣은 것은 반드시 나온다. */
    const panelScenes = new Set(overlays.map((o) => o.scene));
    const charOverlays = script.content_mode === "ORAKI_DETECTIVE"
      ? planCharacterOverlays(script.scenes, panelScenes) : [];
    if (charOverlays.length) {
      logInfo("render", `오락이 합성 — ${charOverlays.length}개 장면에 캐릭터를 얹습니다`);
    }
    const rendered = await renderReel({
      scenes: script.scenes, imageByScene, voicePath: voice.voicePath,
      assPath: subs.assPath, outPath: videoPath, characters: charOverlays,
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
        voice_notice: voiceNotice,
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
  /* 이름과 지역이 글자까지 같을 때만 같은 가게로 보던 탓에,
     AI 조사가 "신림"/"관악구" 처럼 지역을 조금씩 다르게 돌려줄 때마다
     같은 가게가 새로 쌓였다. 이제 이름만 다듬어 맞춰 본다. */
  const existing = findByName(info.name);
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
/**
 * 장면 하나를 다시 만든다.
 * sceneNo 가 null 이면 이미지 전체를 다시 만든다 — 이미지가 통째로 실패했을 때
 * (크레딧 소진 등) 장면마다 한 번씩 누르게 하면 아홉 번을 눌러야 한다.
 * 대본·음성은 건드리지 않으므로 잘 나온 나레이션을 버리지 않는다.
 */
export type RegenScope = "character" | "food" | "background" | "all";

export async function regenerateScene(
  reelId: string,
  sceneNo: number | null,
  what: "image" | "voice" | "subtitle",
  scope: RegenScope = "all",
): Promise<{ scenes: number[] }> {
  const reel = getReel(reelId);
  if (!reel || !reel.script || !reel.output_dir) throw new Error("릴스를 찾을 수 없습니다");
  const script = reel.script;
  // DB 장면 최신값을 대본에 반영 (사용자 수정분)
  for (const s of script.scenes) {
    const dbScene = reel.scenes.find((x) => x.scene === s.scene);
    if (dbScene) Object.assign(s, dbScene);
  }
  const outDir = reel.output_dir;
  /* 다시 만들 때도 처음과 같은 한국 배경 조건을 써야 한다.
     업체가 연결돼 있지 않으면 지역 없이 기본 한국 조건만 쓴다. */
  let place: { area?: string | null; address?: string | null } | undefined;
  try {
    if (reel.restaurant_id) {
      const info = restaurantInfoOf(reel.restaurant_id);
      place = { area: info.area, address: info.address };
    }
  } catch { /* 업체를 못 찾아도 제작은 계속한다 */ }

  let touched: number[] = [];
  if (what === "image") {
    // 무엇을 다시 만들지 고른다 — 캐릭터만 / 음식만 / 배경만 / 선택 장면 / 전체.
    // 전체는 무료 사용량을 가장 많이 먹으므로 화면 쪽에서 기본값으로 두지 않는다.
    const targets = sceneNo !== null
      ? [sceneNo]
      : script.scenes
          .filter((s) => scope === "all" || sceneKindOf(s) === scope)
          .map((s) => s.scene);
    touched = targets;
    if (!targets.length) return { scenes: [] };
    for (const s of script.scenes) {
      if (targets.includes(s.scene)) s.image_hash = null; // 캐시 무효화
    }
    const images = await generateSceneImages(reelId, script.scenes, path.join(outDir, "images"), undefined, targets, place);
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
  return { scenes: touched };
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
  /* 사용자가 장면 편집에서 고친 값(캐릭터 등장 여부 포함)을 대본에 반영한다.
     이걸 빠뜨리면 "다시 만들기" 에서 오락이가 사라진다. */
  for (const sc of script.scenes) {
    const dbScene = reel.scenes.find((x) => x.scene === sc.scene);
    if (dbScene) Object.assign(sc, dbScene);
  }
  /* 음성이 없어도 다시 만들 수 있다 — 무음으로 간다.
     "음성 파일이 없습니다" 로 여기서 멈추면, 음성이 실패한 릴스는 영영 영상을 못 만든다. */
  const voiceCandidate = reel.voice_path ?? path.join(reel.output_dir, "voice.mp3");
  const voicePath = fs.existsSync(voiceCandidate) ? voiceCandidate : null;
  const assPath = path.join(reel.output_dir, "subtitle.ass");
  const imageByScene = new Map(script.scenes.map((s) => [s.scene, s.image_path!] as const));
  const videoPath = path.join(reel.output_dir, "reel.mp4");
  /* 다시 만들 때도 판이 어디에 얹히는지 알아야 캐릭터를 그만큼 낮출 수 있다.
     업체가 휴지통에 갔거나 지워졌어도 영상은 다시 만들 수 있어야 하므로 조용히 넘어간다. */
  let rerenderPanels: Set<number> = new Set();
  try {
    if (reel.restaurant_id) {
      rerenderPanels = new Set(
        buildOverlays(script.scenes, restaurantInfoOf(reel.restaurant_id), {}).map((o) => o.scene),
      );
    }
  } catch { /* 업체를 못 찾으면 판 없이 간다 */ }
  const charOverlays = reel.content_mode === "ORAKI_DETECTIVE"
    ? planCharacterOverlays(script.scenes, rerenderPanels) : [];
  const rendered = await renderReel({
    scenes: script.scenes, imageByScene, voicePath, assPath, outPath: videoPath,
    characters: charOverlays,
  });
  updateReel(reelId, { video_path: videoPath, duration_sec: rendered.totalSec, status: "검수" });
}
