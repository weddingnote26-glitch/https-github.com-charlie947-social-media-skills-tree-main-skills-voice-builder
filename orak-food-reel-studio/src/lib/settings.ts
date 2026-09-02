import { db, j } from "./db";
import { z } from "zod";
import { logWarn } from "./log";

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
    reuseCache: z.boolean().default(true),// 같은 장면이면 기존 이미지 재사용
    /**
     * 비용 정책. 어느 값이든 오락이 캐릭터 품질은 낮추지 않는다 —
     * 배경·음식에서만 아낀다.
     */
    costPolicy: z.enum(["cost_optimized", "balanced", "best"]).default("cost_optimized"),
    /** 릴스 1편에 쓸 이미지 API 호출 상한. 넘으면 멈추고 지금까지 결과는 지킨다 */
    budgetCalls: z.number().int().min(0).max(200).default(20),
    /** 상한에 닿으면 자동으로 멈출지 (끄면 경고만 남기고 계속) */
    budgetStop: z.boolean().default(true),
    /** 캐릭터 장면 하나에 허용할 신규 생성 횟수 */
    maxCharacterGen: z.number().int().min(1).max(4).default(2),
  }).default({
    fallback: true, reuseCache: true, costPolicy: "cost_optimized",
    budgetCalls: 20, budgetStop: true, maxCharacterGen: 2,
  }),

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
    /**
     * 오락이 공식 에셋 폴더 (master / turnaround / actions).
     * 비우면 프로그램에 담긴 기본 에셋을 쓴다. 원본은 읽기만 한다.
     */
    assetRoot: z.string().default(""),
  }).default({ enabled: true, seed: 20260823, referenceImages: [], assetRoot: "" }),

  /**
   * 영상 생성 AI (선택).
   * 지금 제작 흐름은 이미지 + Ken Burns 로 영상을 만든다. 여기 값은 앞으로 영상 생성
   * 서비스를 붙일 때 쓰려고 사용자가 미리 넣어 두는 자리다 — 모델 이름을 코드에 박지 않는다.
   */
  video: z.object({
    provider: z.enum(["none", "kling"]).default("none"),
    /** 서비스가 알려 준 모델 이름을 그대로 넣는다 (짐작해서 채우지 않는다) */
    model: z.string().default(""),
  }).default({ provider: "none", model: "" }),

  /**
   * 주제 추천 (오늘의 릴스 4대 분류 → 세부 주제).
   * 제미나이 모델 이름은 사용자가 넣는다 — 코드에 박지 않는다. 비우면 Claude 로 추천한다.
   */
  topics: z.object({
    geminiModel: z.string().default(""),
  }).default({ geminiModel: "" }),

  /**
   * 인트로 · 아웃트로 (로고 · 배너).
   * 파일은 assets/branding/ 안의 이름만 둔다. 완성 영상 앞뒤에 그림 장면으로 붙는다 (pipeline/branding.ts).
   */
  branding: z.object({
    intro: z.object({ file: z.string().default(""), seconds: z.number().min(0.5).max(10).default(2) }).default({ file: "", seconds: 2 }),
    outro: z.object({ file: z.string().default(""), seconds: z.number().min(0.5).max(10).default(2) }).default({ file: "", seconds: 2 }),
    /** 맛집 릴스에 붙일지 */
    applyToReels: z.boolean().default(true),
    /** 외부 영상 AI 음성 결과에 붙일지 */
    applyToImported: z.boolean().default(true),
  }).default({ intro: { file: "", seconds: 2 }, outro: { file: "", seconds: 2 }, applyToReels: true, applyToImported: true }),

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
  /**
   * §11 Instagram 연동 방식.
   * "auto" 는 토큰 앞글자로 알아서 고른다 (IGAA… → Instagram, EAA… → Facebook).
   * 사용자가 하나로 못 박아 두면, 넣은 토큰이 그 방식과 다를 때 바로 알려 준다.
   * 두 방식의 토큰·권한·주소는 절대 섞지 않는다.
   */
  igLoginMode: z.enum(["auto", "instagram", "facebook"]).default("auto"),

  // 실행 모드 — auto 면 .env 의 APP_MODE 를 따른다
  appMode: z.enum(["auto", "sample", "live"]).default("auto"),

  // 첫 실행 마법사
  wizardDone: z.boolean().default(false),
  wizardStep: z.number().int().min(1).max(8).default(1),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

const KEY = "app_settings";

/**
 * 저장된 설정에서 문제가 된 항목만 덜어낸다.
 *
 * 왜 필요한가: 새 판에서 저장한 값(예: imageProvider="cloudflare")을 옛 판이
 * 읽으면 스키마 검사가 통째로 실패한다. 그러면 설정을 읽는 모든 곳이 죽어서
 * 제작이 0% 에서 멈춘다 — 실제로 그 화면을 받았다.
 *
 * 설정값 하나가 낯설다고 프로그램 전체가 서면 안 된다.
 * 모르는 항목만 버리고 기본값으로 되돌린 뒤 나머지는 그대로 쓴다.
 */
function dropPath(obj: unknown, segments: PropertyKey[]): unknown {
  if (!segments.length || obj === null || typeof obj !== "object") return obj;
  const copy: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  const [head, ...rest] = segments;
  const key = String(head);
  if (!rest.length) delete copy[key];
  else if (key in copy) copy[key] = dropPath(copy[key], rest);
  return copy;
}

export function parseSettings(raw: unknown): AppSettings {
  let obj = raw;
  const dropped: string[] = [];
  // 문제 항목을 하나씩 덜어내며 다시 검사한다 (중첩 항목이 여럿일 수 있어 몇 번 돈다)
  for (let round = 0; round < 8; round++) {
    const r = AppSettingsSchema.safeParse(obj);
    if (r.success) {
      if (dropped.length) {
        logWarn("settings", `알 수 없는 설정값을 기본값으로 되돌렸습니다: ${dropped.join(", ")} — 프로그램을 최신으로 업데이트하면 그대로 쓸 수 있습니다`);
      }
      return r.data;
    }
    const paths = r.error.issues.map((i) => i.path).filter((pth) => pth.length > 0);
    if (!paths.length) break;
    for (const pth of paths) {
      dropped.push(pth.join("."));
      obj = dropPath(obj, pth as PropertyKey[]);
    }
  }
  logWarn("settings", "설정을 읽지 못해 전부 기본값으로 시작합니다 (저장된 값은 지우지 않았습니다)");
  return AppSettingsSchema.parse({});
}

export function getSettings(): AppSettings {
  const row = db().prepare("SELECT value_json FROM settings WHERE key=?").get(KEY) as { value_json: string } | undefined;
  return parseSettings(row ? j(row.value_json, {}) : {});
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
