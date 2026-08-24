import { db, j } from "./db";
import { z } from "zod";

/** 관리자 화면에서 바꾸는 값 — 하드코딩 금지 항목들 (§34, §16, §27 등) */
export const AppSettingsSchema = z.object({
  // 게시 스케줄
  publishDays: z.object({
    mon: z.boolean(), tue: z.boolean(), wed: z.boolean(),
    thu: z.boolean(), fri: z.boolean(), sat: z.boolean(), sun: z.boolean(),
  }).default({ mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: false }),
  publishTime: z.string().regex(/^\d{2}:\d{2}$/).default("11:30"),

  // 릴스 길이
  reelDurationSec: z.number().int().min(15).max(60).default(25),
  durationChoices: z.array(z.number().int()).default([15, 20, 30, 45, 60]),

  // 승인 모드
  approvalMode: z.enum(["SAFE", "AUTO"]).default("SAFE"),

  // 캐릭터 모드 비율 (주 6개 기준, §27)
  orakiPerWeek: z.number().int().min(0).max(6).default(4),

  // ElevenLabs 세부 설정 (§16)
  tts: z.object({
    voiceId: z.string().default(""),
    model: z.string().default("eleven_multilingual_v2"),
    speed: z.number().min(0.7).max(1.2).default(1.06),
    stability: z.number().min(0).max(1).default(0.5),
    similarity: z.number().min(0).max(1).default(0.75),
  }).default({ voiceId: "", model: "eleven_multilingual_v2", speed: 1.06, stability: 0.5, similarity: 0.75 }),

  // 이미지 공급자
  imageProvider: z.enum(["gemini", "openai", "cloudflare", "sample"]).default("sample"),
  imageModel: z.string().default(""),

  // Cloudflare Workers AI (토큰은 여기 두지 않는다 — 암호화 저장소로 간다)
  cloudflare: z.object({
    accountId: z.string().default(""),
    imageModel: z.string().default(""),      // 비우면 flux-1-schnell
    characterModel: z.string().default(""),  // 비우면 참조 이미지를 받는 SDXL-lightning
  }).default({ accountId: "", imageModel: "", characterModel: "" }),

  // 이미지 정책 (§43·§45)
  imagePolicy: z.object({
    fallback: z.boolean().default(true),  // 실패 시 다른 공급자 자동 사용
    reuseCache: z.boolean().default(true) // 같은 장면이면 기존 이미지 재사용
  }).default({ fallback: true, reuseCache: true }),

  // 자막 스타일 (§18~19)
  subtitle: z.object({
    fontSize: z.number().int().min(40).max(120).default(72),
    marginBottomPct: z.number().min(10).max(40).default(22), // 화면 아래에서 띄우는 비율(Instagram UI 회피)
    highlightColor: z.string().default("#FFD84D"),
  }).default({ fontSize: 72, marginBottomPct: 22, highlightColor: "#FFD84D" }),

  // 캐릭터 잠금 (§15 Character Lock)
  characterLock: z.object({
    enabled: z.boolean().default(true),
    seed: z.number().int().default(20260823),
    referenceImages: z.array(z.string()).default([]), // /assets/character/ 내 파일명
  }).default({ enabled: true, seed: 20260823, referenceImages: [] }),

  // BGM
  bgm: z.object({
    file: z.string().default(""),      // /assets/bgm/ 내 사용자 등록 파일
    volumeDb: z.number().default(-22), // 더킹 시 기본 감쇠
  }).default({ file: "", volumeDb: -22 }),

  // 저장 폴더(표시용 — 실제 경로는 프로젝트 내부 고정)
  outputNote: z.string().default(""),

  // 완성 영상을 인터넷에서 내려받을 수 있는 공개 주소 (§32).
  // Instagram 서버가 직접 영상을 받아 가므로 내 PC 주소(localhost)로는 발행되지 않는다.
  // 비우면 .env 의 PUBLIC_MEDIA_BASE_URL 을 쓴다.
  publicMediaBaseUrl: z.string().default(""),

  // 실행 모드 — auto 면 .env 의 APP_MODE 를 따른다
  appMode: z.enum(["auto", "sample", "live"]).default("auto"),

  // 첫 실행 마법사
  wizardDone: z.boolean().default(false),
  wizardStep: z.number().int().min(1).max(8).default(1),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

const KEY = "app_settings";

export function getSettings(): AppSettings {
  const row = db().prepare("SELECT value_json FROM settings WHERE key=?").get(KEY) as { value_json: string } | undefined;
  return AppSettingsSchema.parse(row ? j(row.value_json, {}) : {});
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = AppSettingsSchema.parse({ ...getSettings(), ...patch });
  db().prepare(
    "INSERT INTO settings (key, value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json"
  ).run(KEY, JSON.stringify(merged));
  return merged;
}

/** 임의 키 저장(암호화 토큰 등) */
export function kvGet(key: string): string | null {
  const row = db().prepare("SELECT value_json FROM settings WHERE key=?").get(key) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as string) : null;
}
export function kvSet(key: string, value: string): void {
  db().prepare(
    "INSERT INTO settings (key, value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json"
  ).run(key, JSON.stringify(value));
}
