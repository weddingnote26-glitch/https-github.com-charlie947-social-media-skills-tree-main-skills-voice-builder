/**
 * 이미지 품질 등급 — 어디에 돈을 쓰고 어디서 아낄지 정한다.
 *
 * 원칙: **오락이 얼굴에는 아끼지 않는다.** 캐릭터가 매번 달라 보이면
 * 채널의 정체성이 무너지므로, 비용 절약형에서도 캐릭터 품질은 낮추지 않는다.
 * 대신 배경·음식에서 아낀다 — 이쪽은 조금 거칠어도 영상에서 티가 잘 안 나고,
 * 어차피 합성 단계에서 1080×1920 으로 다시 잡힌다.
 */

export type SceneKind = "character" | "food" | "background";
export type QualityTier = "high" | "standard" | "eco";

export interface TierSetting {
  /** 생성 단계 — 클수록 곱고 비싸다 */
  steps: number;
  /** 만들 때 크기. 최종 1080×1920 은 합성 단계에서 다시 맞춘다 */
  width: number;
  height: number;
  /** 실패했을 때 다시 시도할 횟수 (첫 시도 제외) */
  retries: number;
}

/**
 * 등급별 설정.
 *
 * 값은 "요청에 넣어 볼 값" 이고, 모델이 안 받으면 빼고 다시 보낸다
 * (cloudflare-image.ts). 그래서 모델이 바뀌어도 제작이 멈추지 않는다.
 */
export const TIERS: Record<QualityTier, TierSetting> = {
  // 캐릭터 — 마스터에 가장 가깝게. 여기서는 아끼지 않는다
  high: { steps: 8, width: 768, height: 1344, retries: 1 },
  // 음식 — 중간. 색과 종류만 맞으면 통과라 잔손질에 돈을 쓰지 않는다
  standard: { steps: 4, width: 640, height: 1152, retries: 1 },
  // 배경 — 가장 싸게. 캐릭터가 가리는 자리라 정밀도가 필요 없다
  eco: { steps: 4, width: 512, height: 896, retries: 1 },
};

export type CostPolicy = "cost_optimized" | "balanced" | "best";

/** 화면에 보여줄 이름 */
export const POLICY_LABEL: Record<CostPolicy, string> = {
  cost_optimized: "비용 절약형 — 권장",
  balanced: "균형형",
  best: "최고 품질형",
};

/**
 * 정책 + 장면 종류 → 등급.
 * 어느 정책에서도 캐릭터는 high 아래로 내려가지 않는다.
 */
export function tierFor(policy: CostPolicy, kind: SceneKind): QualityTier {
  if (kind === "character") return "high";
  if (policy === "best") return "high";
  if (policy === "balanced") return kind === "food" ? "standard" : "eco";
  // cost_optimized
  return kind === "food" ? "standard" : "eco";
}

/**
 * 장면 하나가 어떤 종류인지.
 *
 * 대본에는 이미 character_presence(오락이가 얼마나 나오는지)가 들어 있다.
 * 새 항목을 만들지 않고 그 값을 쓴다 — 대본 형식을 바꾸면 기존 릴스가 깨진다.
 */
export function sceneKindOf(scene: {
  character_presence?: string | null;
  visual_prompt?: string;
  narration?: string;
}): SceneKind {
  if (scene.character_presence && scene.character_presence !== "none") return "character";
  const text = `${scene.visual_prompt ?? ""} ${scene.narration ?? ""}`.toLowerCase();
  // 음식이 주인공인 장면 — 접시·국물·클로즈업 등
  if (/food|dish|plate|bowl|noodle|dumpling|meat|soup|close-?up|음식|메뉴|요리|한입/.test(text)) return "food";
  return "background";
}

/** 사람이 읽는 이름 */
export const KIND_LABEL: Record<SceneKind, string> = {
  character: "오락이",
  food: "음식",
  background: "배경",
};
