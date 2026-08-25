/**
 * §15 오락이 Identity Lock — 어떤 이미지 모델을 쓰든 같은 얼굴이 나오게 하는 규칙.
 *
 * "AI 이미지마다 얼굴이 달라지는" 문제를 막는 마지막 방어선이다.
 * 참조 이미지를 받는 모델이면 참조 + 이 문구를, 못 받는 모델이면
 * 이 문구에 금지 규칙까지 합쳐 프롬프트만으로 최대한 붙잡는다.
 */

export const ORAKI_IDENTITY_LOCK = `Use the provided ORAKI MASTER reference image as the exact character identity reference.

Do not redesign the character.

Preserve:
- dumpling-shaped face
- warm beige dumpling skin
- large dark brown sparkling eyes
- rosy cheeks
- brown checkered detective hat
- brown checkered cape
- short round arms and legs
- original body proportions
- original facial proportions

Only change:
- pose
- expression
- action
- camera angle
- food
- background
- lighting`;

/** negative prompt — 지원하는 모델에는 그대로 넣는다 */
export const ORAKI_NEGATIVE_PROMPT = [
  "different character", "different face", "human face", "different clothes",
  "different hat", "different body proportions", "extra arms", "extra legs",
  "extra fingers", "duplicate character", "distorted hands", "deformed face",
  "text artifacts", "watermark",
].join(", ");

/** negative prompt 를 못 받는 모델용 — 본문에 넣을 금지 규칙 문장으로 바꾼다 */
export function negativeAsRules(negative: string): string {
  return `STRICTLY AVOID: ${negative}.`;
}
