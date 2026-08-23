import { getSettings } from "../settings";
import type { Scene } from "../schema";
import path from "node:path";
import fs from "node:fs";
import { DIRS } from "../paths";

/**
 * 만두탐정 오락이 — 오락푸드 전속 맛집 탐정 캐릭터 IP.
 * "오늘도 맛있는 사건을 찾아 신림 골목을 조사한다."
 * 맛집 하나 = 작은 사건 하나. 맛집이 바뀌어도 캐릭터·세계관·사건번호·소품은 유지된다.
 */
export const ORAKI = {
  name: "만두탐정 오락이",
  nameEn: "Oraki the Dumpling Detective",
  world: "신림·관악구의 숨은 맛집을 찾아다니며 직접 먹어보고 단서를 수집하는 맛집 탐정",
  brandColor: "#E86A3A",          // 오락 브랜드 포인트 컬러 — 가방·수첩·그래픽 등 작은 요소에만
  heightCm: 18,                    // §19 실제 크기 15~20cm — 모든 프롬프트에 고정
  // §6 성격: 호기심 30 / 친근함 30 / 유머 20 / 신뢰감 20
  personality: { 호기심: 30, 친근함: 30, 유머: 20, 신뢰감: 20 },
  props: ["브라운 탐정 모자", "작은 돋보기", "오렌지색 미니 탐정 가방", "작은 수첩"],
  // §23 브랜드 반복 장치 — 매 영상 최소 1개 이상
  brandDevices: ["탐정 모자", "돋보기", "오렌지색 가방", "사건 파일", "탐정 수첩", "사건 해결"],
} as const;

/** §14 Character Master Reference 파일 목록 */
export const MASTER_REFERENCE_FILES = [
  "front.png", "side.png", "back.png",
  "face_happy.png", "face_surprised.png", "face_detective.png",
  "character_sheet.png",
] as const;

export function masterReferenceStatus(): Array<{ file: string; exists: boolean; path: string }> {
  return MASTER_REFERENCE_FILES.map((f) => {
    const p = path.join(DIRS.character, f);
    return { file: f, exists: fs.existsSync(p), path: p };
  });
}

/** §7 대표 말투 — 매번 그대로 반복하지 말고 변형해서 사용 */
export const ORAKI_SPEECH_SAMPLES = [
  "오늘도 맛있는 사건 하나 들어왔습니다.",
  "여기 그냥 지나치면 안 되겠는데요?",
  "일단 냄새부터 수상합니다.",
  "직접 확인해보겠습니다.",
  "가격도 단서가 되겠네요.",
  "한입 먹어보겠습니다.",
  "음... 이건 사건이 맞네요.",
  "범인은 바로 이 메뉴였습니다.",
  "오늘 사건 해결.",
  "오락이가 다음 맛집도 찾아보겠습니다.",
];

/** §11 탐정 판정 문구 은행 — 과장 효능·허위 사실 금지 */
export const VERDICT_PHRASES: Record<string, string[]> = {
  "가성비 맛집": ["가성비 혐의 인정.", "지갑이 안심하는 사건.", "가격 대비 유죄, 맛으로 무죄."],
  "혼밥 맛집": ["혼밥 적합 판정.", "혼자 와도 눈치 볼 필요 없음.", "1인 조사 완료, 이상 없음."],
  "부모님과 가기 좋은 곳": ["부모님 모시고 갈 가능성 높음.", "온 가족 출동 허가.", "어르신 입맛 통과 판정."],
  "친구 모임 맛집": ["술 한잔 부르는 사건.", "모임 장소로 채택 가능.", "웨이팅 주의 구역."],
  "메뉴 하나 집중 소개": ["범인은 이 메뉴였습니다.", "단일 메뉴 유죄 확정.", "밥 두 공기 위험지역."],
  "숨은 동네 맛집": ["숨어 있던 혐의 인정.", "동네 주민만 알던 사건.", "재방문 가능성 매우 높음."],
  기본: ["재방문 가능성 높음.", "이 동네 사건 맞습니다.", "저장해둘 만한 사건.", "다이어트 방해 가능성 높음."],
};

export function pickVerdictPhrase(contentType: string, seed: number): string {
  const pool = [...(VERDICT_PHRASES[contentType] ?? []), ...VERDICT_PHRASES["기본"]];
  return pool[seed % pool.length];
}

/** 장면 역할 → 오락이 행동·표정 기본 매핑 (§12~13, 사건 파일 구조 §8) */
export const SCENE_ROLE_MAP: Array<{
  role: string; action: Scene["character_action"]; expression: Scene["character_expression"];
  presence: Scene["character_presence"];
}> = [
  { role: "사건 발생", action: "골목 살펴보기", expression: "Suspicious", presence: "side" },
  { role: "현장 출동", action: "걷기", expression: "Curious", presence: "hero" },
  { role: "첫 번째 단서", action: "돋보기로 음식 관찰", expression: "Curious", presence: "corner" },
  { role: "가격 조사", action: "메뉴판 확인", expression: "Surprised", presence: "side" },
  { role: "결정적 증거", action: "손가락으로 음식 가리키기", expression: "Excited", presence: "none" },
  { role: "직접 검증", action: "한입 먹기", expression: "Shocked", presence: "side" },
  { role: "탐정 판정", action: "수첩에 기록하기", expression: "Serious Detective", presence: "side" },
  { role: "사건 해결", action: "사건 해결 포즈", expression: "Satisfied", presence: "corner" },
  { role: "다음 사건 예고", action: "카메라 쪽으로 설명하기", expression: "Happy", presence: "hero" },
];

/**
 * §20 기본 이미지 프롬프트 — Character Lock(§15) 적용.
 * 현실 맛집 공간 + 작은 만두 탐정(§17~19). 음식이 주인공일 땐 오락이 35% 미만(§16, §21).
 */
export function orakiImagePrompt(opts: {
  sceneDescription: string;
  action?: string | null;
  expression?: string | null;
  presence: Scene["character_presence"];
  area?: string;
}): string {
  const lock = getSettings().characterLock;
  const area = opts.area || "Sillim, Gwanak-gu, Seoul";
  const base = [
    `A small anthropomorphic steamed dumpling detective named Oraki, approximately ${ORAKI.heightCm}cm tall,`,
    "round white dumpling body with realistic steamed dough texture, distinctive folded dumpling top,",
    "warm expressive eyes, small arms and legs, wearing a brown detective hat,",
    "carrying a small magnifying glass and an orange (#E86A3A) accent detective bag.",
  ].join(" ");

  const presenceRule = {
    none: "Do not include the character in this shot. The food is the only hero, filling the frame.",
    corner: "The character appears small in a lower corner, occupying less than 20% of the frame. The food is the visual hero, large and appetizing.",
    side: "The character stands beside the subject, occupying less than 35% of the frame. The food/scene remains the visual hero.",
    hero: "The character is the main subject of this transitional shot, standing naturally in the real environment.",
  }[opts.presence];

  const acting = [
    opts.action ? `Character action: ${opts.action}.` : "",
    opts.expression ? `Facial expression: ${opts.expression} — expressive but the face shape and identity never change.` : "",
    "The mouth never opens unnaturally wide; the body never deforms.", // §22
  ].filter(Boolean).join(" ");

  return [
    opts.presence === "none" ? "" : base,
    `Scene: ${opts.sceneDescription}`,
    `Setting: a real Korean restaurant / street in ${area}.`,
    "The restaurant, street and food must look photorealistic, as if filmed with a modern smartphone.",
    opts.presence === "none" ? "" : "The character appears physically present in the real environment, with realistic lighting, shadows and correct 18cm scale relative to tables and dishes.",
    presenceRule,
    opts.presence === "none" ? "" : acting,
    "Natural lighting, realistic shadows, natural steam, realistic food texture, smartphone food photography.",
    "Vertical 9:16 Instagram Reels composition. Do not generate any text in the image.",
    lock.enabled
      ? "Maintain exactly the same character identity, face, eye shape, hat, proportions and colors as the reference character sheet."
      : "",
    lock.enabled && lock.seed ? `Character seed: ${lock.seed}.` : "",
  ].filter(Boolean).join(" ");
}

/** 시리즈 제목: [맛집사건 #007] */
export function caseLabel(n: number): string {
  return `맛집사건 #${String(n).padStart(3, "0")}`;
}
