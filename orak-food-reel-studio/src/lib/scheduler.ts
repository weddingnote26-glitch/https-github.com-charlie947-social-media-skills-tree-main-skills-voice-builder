import { db, j } from "./db";
import { newId } from "./id";
import { getSettings } from "./settings";
import { getPublisher, friendlyInstagramError } from "./providers/instagram";
import { getEnv } from "./env";
import { updateReel, getReel, reelFactcheck } from "./reels";
import { logError, logInfo, logWarn } from "./log";
import { redact } from "./redact";

/**
 * §34 게시 스케줄(요일·시간은 관리자 설정, 하드코딩 금지) +
 * §32 Instagram 발행 흐름(컨테이너 → FINISHED 확인 → publish → DB 기록).
 */

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** 다음 발행 가능 슬롯(요일 ON + 아직 예약 없는 날짜) */
export function computeNextSlot(from = new Date()): string {
  const s = getSettings();
  const [hh, mm] = s.publishTime.split(":").map(Number);
  for (let d = 0; d < 21; d++) {
    const cand = new Date(from);
    cand.setDate(cand.getDate() + d);
    cand.setHours(hh, mm, 0, 0);
    if (cand <= from) continue;
    if (!s.publishDays[DAY_KEYS[cand.getDay()]]) continue;
    const iso = toLocalIso(cand);
    const taken = db().prepare(
      "SELECT COUNT(*) AS c FROM schedules WHERE publish_at=? AND status IN ('예약','발행중')"
    ).get(iso) as { c: number };
    if (taken.c === 0) return iso;
  }
  throw new Error("3주 안에 비어 있는 발행 슬롯이 없습니다");
}

function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export function scheduleReel(reelId: string, publishAt?: string): { scheduleId: string; publishAt: string } {
  const reel = getReel(reelId);
  if (!reel) throw new Error("릴스를 찾을 수 없습니다");
  if (!reel.video_path) throw new Error("영상이 아직 없습니다");
  // §33: FACT CHECK 차단 콘텐츠는 예약 불가
  const q = j<{ fact_blocked?: boolean; fact_block_reasons?: string[] }>(reel.quality_json, {});
  if (q.fact_blocked) {
    throw new Error("팩트체크 확인 필요 항목이 있어 예약할 수 없습니다: " + (q.fact_block_reasons ?? []).join(" / "));
  }
  const at = publishAt ?? computeNextSlot();
  const id = newId("sch");
  db().prepare("INSERT INTO schedules (id, reel_id, publish_at, status) VALUES (?,?,?,'예약')").run(id, reelId, at);
  updateReel(reelId, { status: "예약", planned_date: at.slice(0, 10) });
  logInfo("schedule", `예약 완료 — ${reelId} @ ${at}`);
  return { scheduleId: id, publishAt: at };
}

export function autoSchedule(reelId: string): void {
  try { scheduleReel(reelId); } catch (e) {
    logWarn("schedule", `자동 예약 실패: ${e instanceof Error ? e.message : e}`);
  }
}

/** 지금 발행 — 예약 없이 즉시 발행 잡 생성 */
export function publishNow(reelId: string): { jobId: string } {
  const jobId = newId("pub");
  db().prepare("INSERT INTO publishing_jobs (id, reel_id, phase) VALUES (?,?,'대기')").run(jobId, reelId);
  updateReel(reelId, { status: "예약" });
  return { jobId };
}

/** 매 분 호출되는 틱 — 예약 도래분을 발행 잡으로 전환하고, 발행 잡 상태기계를 진행 */
export async function tick(now = new Date()): Promise<void> {
  const nowIso = toLocalIso(now);
  // 1) 도래한 예약 → 발행 잡
  const due = db().prepare(
    "SELECT * FROM schedules WHERE status='예약' AND publish_at<=?"
  ).all(nowIso) as Array<{ id: string; reel_id: string }>;
  for (const s of due) {
    db().prepare("UPDATE schedules SET status='발행중' WHERE id=?").run(s.id);
    db().prepare("INSERT INTO publishing_jobs (id, reel_id, schedule_id, phase) VALUES (?,?,?,'대기')")
      .run(newId("pub"), s.reel_id, s.id);
    logInfo("schedule", `발행 시작 — ${s.reel_id}`);
  }
  // 2) 발행 잡 진행
  const jobs = db().prepare(
    `SELECT * FROM publishing_jobs WHERE phase NOT IN ('완료','실패')
     AND (next_retry_at IS NULL OR next_retry_at<=?)`
  ).all(nowIso) as Array<{
    id: string; reel_id: string; schedule_id: string | null; phase: string;
    container_id: string | null; attempts: number;
  }>;
  for (const job of jobs) {
    try {
      await advancePublishJob(job);
    } catch (e) {
      onJobError(job, e);
    }
  }
}

function jobUpdate(id: string, patch: Record<string, unknown>): void {
  const keys = Object.keys(patch);
  db().prepare(`UPDATE publishing_jobs SET ${keys.map((k) => `${k}=?`).join(", ")}, updated_at=datetime('now') WHERE id=?`)
    .run(...keys.map((k) => patch[k]), id);
}

async function advancePublishJob(job: {
  id: string; reel_id: string; schedule_id: string | null; phase: string; container_id: string | null; attempts: number;
}): Promise<void> {
  const reel = getReel(job.reel_id);
  if (!reel) throw new Error("릴스가 삭제되었습니다");

  // §33 FACT CHECK 실패 콘텐츠는 발행 금지 (AUTO MODE 포함)
  const facts = reelFactcheck(reel);
  if (facts.length === 0) throw new Error("팩트체크 기록이 없어 발행할 수 없습니다");
  const q = j<{ fact_blocked?: boolean; fact_block_reasons?: string[] }>(reel.quality_json, {});
  if (q.fact_blocked) {
    throw new Error("팩트체크 차단: " + (q.fact_block_reasons ?? []).join(" / "));
  }

  const publisher = getPublisher();
  const env = getEnv();

  if (job.phase === "대기") {
    // 공개 HTTPS URL 확보 (§32)
    if (publisher.name !== "sample" && !env.PUBLIC_MEDIA_BASE_URL) {
      throw new Error("PUBLIC_MEDIA_BASE_URL이 설정되지 않았습니다. 설정 → Instagram에서 공개 미디어 주소를 입력하세요.");
    }
    const videoUrl = publicUrlFor(reel.video_path!);
    const coverUrl = reel.thumb_path ? publicUrlFor(reel.thumb_path) : undefined;
    const caption = [reel.caption, "", j<string[]>(reel.hashtags_json, []).join(" ")].join("\n").trim();
    const { containerId } = await publisher.createReelContainer({ videoUrl, caption, coverUrl });
    jobUpdate(job.id, { phase: "처리대기", container_id: containerId, attempts: 0 });
    logInfo("publish", `컨테이너 생성 — ${containerId}`);
    return;
  }

  if (job.phase === "처리대기") {
    const { status, detail } = await publisher.getContainerStatus(job.container_id!);
    if (status === "FINISHED") {
      // FINISHED 확인 후에만 publish (§32)
      const { mediaId } = await publisher.publish(job.container_id!);
      const permalink = await publisher.getPermalink(mediaId).catch(() => "");
      db().prepare("INSERT INTO instagram_posts (id, reel_id, ig_media_id, permalink) VALUES (?,?,?,?)")
        .run(newId("igp"), job.reel_id, mediaId, permalink);
      jobUpdate(job.id, { phase: "완료" });
      if (job.schedule_id) db().prepare("UPDATE schedules SET status='발행완료' WHERE id=?").run(job.schedule_id);
      updateReel(job.reel_id, { status: "발행완료" });
      logInfo("publish", `발행 완료 — ${mediaId} ${permalink}`);
      return;
    }
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`컨테이너 처리 실패: ${status} ${detail ?? ""}`);
    }
    // IN_PROGRESS → 30초 후 재확인 (최대 40회 ≈ 20분)
    const attempts = job.attempts + 1;
    if (attempts > 40) throw new Error("컨테이너 처리 시간 초과(20분)");
    jobUpdate(job.id, { attempts, next_retry_at: toLocalIso(new Date(Date.now() + 30_000)) });
    return;
  }
}

function onJobError(job: { id: string; reel_id: string; schedule_id: string | null; attempts: number; phase: string }, e: unknown): void {
  // 원문은 재시도 판단에만 쓰고, 남기는 글은 사람이 읽을 문장으로 바꾼 뒤 비밀값을 지운다.
  // (Meta 오류에는 요청 주소가 섞여 나올 수 있고, last_error 는 DB와 화면에 그대로 남는다)
  const raw = e instanceof Error ? e.message : String(e);
  const msg = redact(friendlyInstagramError(e));
  const attempts = job.attempts + 1;
  // §43 Instagram 실패 → 영상은 삭제하지 않고 재발행 가능 상태 유지
  if (attempts >= 5 || job.phase === "대기") {
    // 생성 단계 오류는 즉시 실패 처리(설정 문제일 가능성) — 단 429/일시 오류는 재시도
    const transient = /429|timeout|ECONN|fetch failed|5\d\d/.test(raw);
    if (!transient || attempts >= 5) {
      jobUpdate(job.id, { phase: "실패", last_error: msg.slice(0, 500), attempts });
      if (job.schedule_id) db().prepare("UPDATE schedules SET status='실패' WHERE id=?").run(job.schedule_id);
      updateReel(job.reel_id, { status: "실패" });
      logError("publish", `발행 실패 — ${msg}`);
      return;
    }
  }
  const backoff = Math.min(10 * 60, 30 * 2 ** attempts);
  jobUpdate(job.id, { attempts, last_error: msg.slice(0, 500), next_retry_at: toLocalIso(new Date(Date.now() + backoff * 1000)) });
  logWarn("publish", `발행 재시도 예정(${attempts}회): ${msg}`);
}

/** 실패 잡 재발행 (§43) */
export function retryPublish(reelId: string): { jobId: string } {
  db().prepare("UPDATE publishing_jobs SET phase='실패' WHERE reel_id=? AND phase NOT IN ('완료','실패')").run(reelId);
  return publishNow(reelId);
}

export function publicUrlFor(absPath: string): string {
  const env = getEnv();
  const norm = absPath.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/output/");
  const rel = idx >= 0 ? norm.slice(idx) : `/output/${norm.split("/").slice(-2).join("/")}`;
  const base = (env.PUBLIC_MEDIA_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return base + rel;
}

/* ---- 싱글턴 타이머 (§39 Scheduler) ---- */
declare global {
  // eslint-disable-next-line no-var
  var __orakSchedulerStarted: boolean | undefined;
}

export function startScheduler(): void {
  if (globalThis.__orakSchedulerStarted) return;
  globalThis.__orakSchedulerStarted = true;
  logInfo("schedule", "스케줄러 시작 (30초 주기)");
  setInterval(() => {
    tick().catch((e) => logError("schedule", `틱 오류: ${e instanceof Error ? e.message : e}`));
  }, 30_000).unref?.();
}
