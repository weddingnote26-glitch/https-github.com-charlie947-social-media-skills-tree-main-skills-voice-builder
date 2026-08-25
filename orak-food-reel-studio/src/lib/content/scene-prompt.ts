/**
 * 이미지 생성 프롬프트에 "한국"과 "글자 없음"을 못 박는 자리.
 *
 * 실제로 겪은 문제:
 *   - 배경이 미국 다이너·일본 이자카야처럼 나왔다
 *   - 간판과 메뉴판에 영어·일본어·중국어, 뜻 없는 가짜 글자가 찍혔다
 *
 * 원인: 대본이 만든 visual_prompt 를 그대로 이미지 모델에 넘겼다.
 * 모델은 한국을 기본으로 삼지 않고, 한글은 거의 항상 깨뜨린다.
 *
 * 그래서 두 가지를 규칙으로 만든다.
 *   1) 장소는 언제나 대한민국 — 업체 주소가 있으면 그 지역까지 적는다
 *   2) 간판·메뉴판은 **빈 판**으로 그리게 하고, 글자는 프로그램이 한글 폰트로 합성한다
 *      (AI 가 그린 한글은 깨져서 그대로 쓸 수 없다)
 */

/** 어느 장면에나 붙는 한국 로컬 조건 */
const KOREA_BASE = [
  "Location: South Korea",
  "authentic Korean neighborhood restaurant",
  "Korean building and street details",
  "Korean tableware and side dishes",
  "natural Korean interior lighting",
].join(", ");

/**
 * 글자를 그리지 말라는 지시.
 * "한글로 써라" 가 아니라 "아무 글자도 쓰지 마라" 여야 한다 —
 * 모델에게 한글을 맡기면 깨진 글자가 나오고, 그 위에 덮어쓰기도 어렵다.
 */
const NO_TEXT = [
  "blank signboard without any text",
  "empty menu board with no letters",
  "clean information panel with no writing",
  "no lettering anywhere in the image",
].join(", ");

/** 모델이 negative prompt 를 받으면 그대로 넣는다 */
export const KOREAN_SCENE_NEGATIVE = [
  // 외국어 간판
  "English sign", "Japanese text", "Chinese text", "Thai text", "foreign language sign",
  // 깨진 글자 — 이번 문제의 핵심
  "gibberish letters", "unreadable text", "fake typography", "garbled hangul", "random characters",
  // 외국 배경
  "American diner", "European street", "Japanese izakaya", "Chinese restaurant sign",
  "southeast asian night market", "foreign license plate",
  // 외국 통화
  "dollar price", "yen price", "yuan price", "foreign currency",
].join(", ");

/** negative 를 못 받는 모델용 — 본문에 넣을 금지 문장 */
export function koreanNegativeAsRules(): string {
  return `STRICTLY AVOID: ${KOREAN_SCENE_NEGATIVE}.`;
}

/** "서울 관악구 신림동" → "Seoul, 관악구 신림동" 처럼 지역만 짧게 뽑는다 */
export function localeHint(area?: string | null, address?: string | null): string {
  const src = (address ?? "").trim() || (area ?? "").trim();
  if (!src) return "";
  // 주소는 길다. 앞의 3덩어리(시·구·동)면 배경을 잡기에 충분하다.
  const head = src.split(/\s+/).slice(0, 3).join(" ");
  return head;
}

export interface ScenePromptInput {
  /** 대본이 만든 원본 영어 프롬프트 */
  visualPrompt: string;
  /** 업체 지역 — 있으면 배경에 반영한다 */
  area?: string | null;
  address?: string | null;
  /** 이 장면에 오락이가 나오는가 */
  characterScene?: boolean;
  /** 모델이 negative prompt 를 따로 받는가 */
  supportsNegative?: boolean;
}

/**
 * 실제로 이미지 모델에 보낼 프롬프트를 만든다.
 * 원본 visual_prompt 를 지우지 않고 **조건을 덧붙인다** — 장면 내용은 대본이 정한다.
 */
export function buildScenePrompt(input: ScenePromptInput): string {
  const where = localeHint(input.area, input.address);
  const parts = [
    input.visualPrompt.trim(),
    where ? `${KOREA_BASE}, specifically ${where}` : KOREA_BASE,
    NO_TEXT,
  ];
  // negative 를 못 받는 모델에는 금지 규칙을 본문에 붙인다
  if (!input.supportsNegative) parts.push(koreanNegativeAsRules());
  return parts.filter(Boolean).join("\n\n");
}

/**
 * 프롬프트가 규칙을 지키는지 스스로 확인한다 (시험과 제작 전 점검에서 쓴다).
 * 한 곳에서 만들었더라도, 나중에 다른 경로가 생기면 여기서 걸린다.
 */
export function scenePromptIssues(prompt: string): string[] {
  const out: string[] = [];
  const p = prompt.toLowerCase();
  if (!p.includes("south korea")) out.push("한국이라는 조건이 빠졌습니다");
  if (!p.includes("blank signboard") && !p.includes("no lettering")) {
    out.push("간판을 빈 판으로 그리라는 조건이 빠졌습니다");
  }
  return out;
}
