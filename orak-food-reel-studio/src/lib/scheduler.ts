import { db, j } from "./db";
import { newId } from "./id";
import { getSettings } from "./settings";
import { getPublisher, friendlyInstagramError, igAuthStatus } from "./providers/instagram";
import { getEnv } from "./env";
import { updateReel, getReel, reelFactcheck } from "./reels";
import { logError, logInfo, logWarn } from "./log";
import { publishBlockReason } from "./review";
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
  // 영상 · 팩트체크 · 발행 전 검수를 한 자리에서 본다 (§5, §33)
  const blocked = publishBlockReason(reelId);
  if (blocked) throw new Error(blocked);
  const at = publishAt ? normalizeSlot(publishAt) : computeNextSlot();
  const id = newId("sch");
  db().prepare("INSERT INTO schedules (id, reel_id, publish_at, status) VALUES (?,?,?,'예약')").run(id, reelId, at);
  updateReel(reelId, { status: "예약", planned_date: at.slice(0, 10) });
  logInfo("schedule", `예약 완료 — ${reelId} @ ${at}`);
  return { scheduleId: id, publishAt: at };
}

/**
 * §8 사람이 고른 발행 시각을 검사하고 다듬는다.
 *
 * 시간대는 Asia/Seoul 하나로 본다 — 이 프로그램은 신림·관악구 가게를 다루고
 * 사장님도 한국에 계신다. 화면에서 고른 시각을 그대로 저장한다.
 * 지난 시각은 저장하지 않는다. 저장해 봐야 곧바로 발행되거나 영영 안 나간다.
 */
export const SCHEDULE_TIMEZONE = "Asia/Seoul";
/** 지금부터 최소 이만큼 뒤라야 예약할 수 있다 (준비 시간) */
export const MIN_LEAD_MINUTES = 5;

export function normalizeSlot(input: string, now = new Date()): string {
  const raw = input.trim();
  // "2026-08-25T14:30" / "2026-08-25 14:30" / 초까지 붙은 것 모두 받는다
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) throw new Error("발행 시각을 알아볼 수 없습니다. 날짜와 시간을 다시 골라 주세요.");
  const at = `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}`;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error("없는 날짜입니다. 다시 골라 주세요.");
  const earliest = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000);
  if (when.getTime() < earliest.getTime()) {
    throw new Error(`지난 시각으로는 예약할 수 없습니다. 지금부터 ${MIN_LEAD_MINUTES}분 뒤부터 고를 수 있습니다.`);
  }
  return at;
}

/** 화면의 날짜·시간 칸에 넣을 "지금 고를 수 있는 가장 이른 시각" */
export function earliestSlot(now = new Date()): string {
  const t = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`;
}

/** 예약 하나의 시각을 바꾼다 (목록에서 [수정]) */
export function rescheduleAt(scheduleId: string, publishAt: string): { publishAt: string } {
  const row = db().prepare("SELECT reel_id, status FROM schedules WHERE id=?").get(scheduleId) as { reel_id: string; status: string } | undefined;
  if (!row) throw new Error("예약을 찾을 수 없습니다");
  if (row.status !== "예약") throw new Error(`이미 ${row.status} 상태라 시각을 바꿀 수 없습니다.`);
  const at = normalizeSlot(publishAt);
  db().prepare("UPDATE schedules SET publish_at=? WHERE id=?").run(at, scheduleId);
  updateReel(row.reel_id, { planned_date: at.slice(0, 10) });
  logInfo("schedule", `예약 시각 변경 — ${row.reel_id} @ ${at}`);
  return { publishAt: at };
}

/** 예약 취소 — 릴스는 검수 상태로 되돌린다 (내용은 그대로 둔다) */
export function cancelSchedule(scheduleId: string): void {
  const row = db().prepare("SELECT reel_id, status FROM schedules WHERE id=?").get(scheduleId) as { reel_id: string; status: string } | undefined;
  if (!row) throw new Error("예약을 찾을 수 없습니다");
  if (row.status !== "예약") throw new Error(`이미 ${row.status} 상태라 취소할 수 없습니다.`);
  db().prepare("UPDATE schedules SET status='취소' WHERE id=?").run(scheduleId);
  const left = db().prepare("SELECT COUNT(*) AS c FROM schedules WHERE reel_id=? AND status='예약'").get(row.reel_id) as { c: number };
  if (left.c === 0) updateReel(row.reel_id, { status: "검수" });
  logInfo("schedule", `예약 취소 — ${row.reel_id}`);
}

export function autoSchedule(reelId: string): void {
  try { scheduleReel(reelId); } catch (e) {
    logWarn("schedule", `자동 예약 실패: ${e instanceof Error ? e.message : e}`);
  }
}

/** 지금 발행 — 예약 없이 즉시 발행 잡 생성 */
export function publishNow(reelId: string, requestKey?: string): { jobId: string; reused: boolean } {
  /**
   * 영상이 없는 릴스를 발행하려 하면 여기서 막는다.
   *
   * 예약(scheduleReel)에는 이 검사가 있었는데 [지금 발행]에는 없었다. 그래서
   * 영상이 안 만들어진 릴스도 발행 잡으로 넘어갔고, 샘플 발행기가 성공 처리해
   * "발행완료 인데 영상이 없는" 상태가 만들어졌다 — 실제로 그 화면을 받았다.
   */
  const blocked = publishBlockReason(reelId);
  if (blocked) throw new Error(blocked);

  /* 같은 요청 열쇠로 두 번 들어오면 (단추 연타·새로고침 재전송) 새 잡을 만들지 않는다.
     이 검사는 "이미 발행 중" 보다 먼저 와야 한다. 같은 요청을 오류로 돌려주면
     사용자는 실패한 줄 알고 다시 누른다 — 그게 진짜 중복 게시를 부른다. */
  if (requestKey) {
    const same = db().prepare("SELECT id FROM publishing_jobs WHERE request_key=? LIMIT 1").get(requestKey) as { id: string } | undefined;
    if (same) return { jobId: same.id, reused: true };
  }

  /* 같은 릴스를 두 번 발행하지 않는다.
     단추를 연달아 누르거나 예약과 즉시 발행이 겹치면 같은 영상이 두 번 올라간다.
     이미 올라간 기록이 있거나 진행 중인 잡이 있으면 여기서 막는다. */
  const posted = db().prepare("SELECT ig_media_id FROM instagram_posts WHERE reel_id=? LIMIT 1").get(reelId) as { ig_media_id: string } | undefined;
  if (posted) {
    throw new Error(`이미 발행된 릴스입니다 (미디어 ID ${posted.ig_media_id}). 다시 올리려면 [다시 게시] 를 골라 주세요.`);
  }
  const running = db().prepare(
    "SELECT id, phase FROM publishing_jobs WHERE reel_id=? AND phase NOT IN ('완료','실패') LIMIT 1"
  ).get(reelId) as { id: string; phase: string } | undefined;
  if (running) throw new Error(`이미 발행 중입니다 (${running.phase}). 잠시 기다려 주세요.`);

  const jobId = newId("pub");
  db().prepare("INSERT INTO publishing_jobs (id, reel_id, phase, request_key) VALUES (?,?,'대기',?)")
    .run(jobId, reelId, requestKey ?? null);
  updateReel(reelId, { status: "예약" });
  return { jobId, reused: false };
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
    if (publisher.name !== "sample" && !resolvePublicMediaBase()) {
      throw new Error("완성 영상의 공개 주소가 없습니다. 설정 → Instagram → [영상 공개 주소] 칸에 넣어 주세요. Instagram 서버가 그 주소로 영상을 내려받습니다.");
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
      /* 나중에 "이거 언제 어느 계정으로 올렸더라" 를 찾을 수 있게 남긴다.
         토큰은 절대 남기지 않는다 — 계정 ID 는 비밀이 아니다. */
      const who = igAuthStatus();
      const reelRow = getReel(job.reel_id);
      db().prepare(
        `INSERT INTO instagram_posts (id, reel_id, ig_media_id, permalink, restaurant_id, account, status, attempts)
         VALUES (?,?,?,?,?,?,'발행완료',?)`
      ).run(newId("igp"), job.reel_id, mediaId, permalink,
        reelRow?.restaurant_id ?? null, who.userId || null, (job.attempts ?? 0) + 1);
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

/** 설정 화면 값 우선, 없으면 .env — 다른 설정들과 같은 규칙 */
export function resolvePublicMediaBase(): string {
  const fromSettings = getSettings().publicMediaBaseUrl.trim();
  return (fromSettings || getEnv().PUBLIC_MEDIA_BASE_URL || "").replace(/\/$/, "");
}

export function publicUrlFor(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/output/");
  const rel = idx >= 0 ? norm.slice(idx) : `/output/${norm.split("/").slice(-2).join("/")}`;
  const base = resolvePublicMediaBase() || "http://localhost:3000";
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
