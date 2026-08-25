import { z } from "zod";

/** §12~13 오락이 행동/표정 라이브러리 */
export const ORAKI_ACTIONS = [
  "걷기", "골목 살펴보기", "문 열고 들어가기", "돋보기로 음식 관찰", "메뉴판 확인",
  "가격 보고 놀라기", "음식 냄새 맡기", "젓가락 들기", "한입 먹기", "눈 커지기",
  "고개 끄덕이기", "수첩에 기록하기", "지도 확인", "손가락으로 음식 가리키기",
  "카메라 쪽으로 설명하기", "엄지척", "사건 해결 포즈",
] as const;

export const ORAKI_EXPRESSIONS = [
  "Neutral", "Curious", "Suspicious", "Surprised", "Excited",
  "Satisfied", "Thinking", "Serious Detective", "Happy", "Shocked",
] as const;

export const CAMERA_MOTIONS = [
  "slow_zoom_in", "slow_zoom_out", "pan_left", "pan_right", "push_up", "push_down", "static",
] as const;

export const CONTENT_TYPES = [
  "가성비 맛집", "숨은 동네 맛집", "부모님과 가기 좋은 곳", "5070 추천 맛집",
  "혼밥 맛집", "데이트 맛집", "친구 모임 맛집", "메뉴 하나 집중 소개",
  "가격 대비 만족도", "오래된 동네 맛집", "반전 맛집", "직접 가보고 싶은 맛집",
] as const;

export const CONTENT_MODES = ["NORMAL_FOOD", "ORAKI_DETECTIVE"] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

export const SceneSchema = z.object({
  scene: z.number().int().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  narration: z.string(),                    // TTS로 읽는 문장 (짧게)
  subtitle: z.string(),                     // 화면 자막 (1~2줄, 한 줄 8~15자)
  visual_prompt: z.string(),                // 이미지 생성 프롬프트
  camera_motion: z.enum(CAMERA_MOTIONS).default("slow_zoom_in"),
  character_action: z.enum(ORAKI_ACTIONS).nullish(),
  character_expression: z.enum(ORAKI_EXPRESSIONS).nullish(),
  /** 캐릭터 화면 점유율 상한(§16: 음식 60% / 오락이 40%) */
  character_presence: z.enum(["none", "corner", "side", "hero"]).default("none"),
  fact_source: z.string().default(""),      // 이 장면 정보의 근거 (없으면 "미확인")
  image_path: z.string().nullish(),         // 생성된 이미지 경로(캐시)
  image_hash: z.string().nullish(),         // visual_prompt 해시(§45 캐시 키)
});
export type Scene = z.infer<typeof SceneSchema>;

/** §10 오락이 탐정 판정 — 실제 사용자 리뷰처럼 보이면 안 됨 */
export const VerdictSchema = z.object({
  label: z.literal("오락이 탐정 판정").default("오락이 탐정 판정"),
  가성비: z.number().int().min(1).max(5),
  맛: z.number().int().min(1).max(5),
  양: z.number().int().min(1).max(5),
  재방문: z.number().int().min(1).max(5),
  한줄판정: z.string(),                     // 예: "가성비 혐의 인정."
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const FactCheckItemSchema = z.object({
  field: z.string(),                        // 매장명/주소/메뉴/가격/영업시간/휴무/주차/예약
  value: z.string(),
  status: z.enum(["확인", "미확인", "사용자 입력"]),
  source: z.string().default(""),
});
export type FactCheckItem = z.infer<typeof FactCheckItemSchema>;

/** §56 릴스 생성 JSON — AI 핵심 출력 */
export const ReelScriptSchema = z.object({
  title: z.string().min(1),
  restaurant: z.string().min(1),
  target: z.string().default("관악구 40~70대"),
  hook: z.string().min(1),
  duration: z.number().int().min(15).max(60),
  content_mode: z.enum(CONTENT_MODES).default("ORAKI_DETECTIVE"),
  content_type: z.enum(CONTENT_TYPES),
  case_number: z.number().int().nullish(),  // 오락이 모드일 때 맛집사건 번호
  case_title: z.string().nullish(),
  scenes: z.array(SceneSchema).min(5).max(10),
  caption: z.string().default(""),
  hashtags: z.array(z.string()).min(3).max(15),
  cta: z.string().min(1),
  verdict: VerdictSchema.nullish(),
  fact_check: z.array(FactCheckItemSchema).default([]),
  quality_score: z.number().min(0).max(100).default(0),
}).superRefine((v, ctx) => {
  // 장면 시간 검증: 순서·범위·총 길이
  let prevEnd = 0;
  for (const s of v.scenes) {
    if (s.end <= s.start) {
      ctx.addIssue({ code: "custom", message: `SCENE ${s.scene}: 종료(${s.end})가 시작(${s.start})보다 빨라야 합니다` });
    }
    if (Math.abs(s.start - prevEnd) > 0.51) {
      ctx.addIssue({ code: "custom", message: `SCENE ${s.scene}: 이전 장면과 시간이 이어지지 않습니다` });
    }
    prevEnd = s.end;
  }
  if (Math.abs(prevEnd - v.duration) > 3) {
    ctx.addIssue({ code: "custom", message: `총 길이(${prevEnd}s)가 duration(${v.duration}s)과 3초 이상 차이납니다` });
  }
  if (v.content_mode === "ORAKI_DETECTIVE" && !v.verdict) {
    ctx.addIssue({ code: "custom", message: "오락이 모드에는 탐정 판정(verdict)이 필요합니다" });
  }
});
export type ReelScript = z.infer<typeof ReelScriptSchema>;

/** 맛집 기본 정보 (§6) */
export const RestaurantInfoSchema = z.object({
  name: z.string().min(1),
  area: z.string().default("관악구"),
  address: z.string().default(""),
  phone: z.string().default(""),
  map_url: z.string().default(""),
  source_url: z.string().default(""),
  menus: z.array(z.object({
    name: z.string(),
    price: z.string().default(""),
    verified: z.boolean().default(false),
  })).default([]),
  hours: z.string().default(""),
  closed_days: z.string().default(""),
  parking: z.string().default(""),
  reservation: z.string().default(""),
  features: z.array(z.string()).default([]),
  review_summary: z.string().default(""),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  recommended_for: z.string().default(""),
  /** 항목별 확인 상태. "사용자 입력"은 사장님/운영자가 직접 적어 넣은 값이다. */
  field_status: z.record(z.string(), z.enum(["확인", "미확인", "사용자 입력"])).default({}),
});
export type RestaurantInfo = z.infer<typeof RestaurantInfoSchema>;

/** 주간 기획안 항목 (§29) */
export const WeeklyItemSchema = z.object({
  date: z.string(),
  weekday: z.string(),
  content_type: z.enum(CONTENT_TYPES),
  content_mode: z.enum(CONTENT_MODES),
  area: z.string(),
  restaurant_hint: z.string().default(""),
  reel_id: z.string().nullish(),
  status: z.string().default("기획"),
});
export type WeeklyItem = z.infer<typeof WeeklyItemSchema>;
