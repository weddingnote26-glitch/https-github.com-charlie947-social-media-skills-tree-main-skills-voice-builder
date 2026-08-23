/**
 * 이미지 모델 이름 규칙 — 무거운 의존성 없이 쓰려고 따로 뒀다.
 * (설정 저장 API와 이미지 공급자가 같은 규칙을 공유한다)
 */

/** 모델 이름이 어느 공급자 것인지 */
export function modelOwner(model: string): "gemini" | "openai" | null {
  const k = model.toLowerCase();
  if (k.includes("imagen") || k.includes("gemini")) return "gemini";
  if (k.startsWith("gpt-") || k.startsWith("dall-e")) return "openai";
  return null;
}

/**
 * 공급자를 바꿔도 예전 모델 이름이 설정에 남아 있는 경우가 있다.
 * (Gemini → OpenAI 로 바꿨는데 imagen-3.0… 이 그대로 남는 식)
 * 다른 공급자 모델이면 무시하고 기본값을 쓴다 — 사용자가 원인 모를 400을 보지 않게.
 */
export function pickImageModel(
  provider: "gemini" | "openai",
  configured: string | undefined,
  fallback: string,
): string {
  const m = (configured ?? "").trim();
  if (!m) return fallback;
  const owner = modelOwner(m);
  if (owner && owner !== provider) return fallback;
  return m;
}

/** 공급자를 바꿀 때 남아 있던 다른 공급자 모델을 비운다 */
export function clearStaleImageModel(
  provider: "gemini" | "openai" | "sample",
  model: string | undefined,
): string {
  const m = (model ?? "").trim();
  if (!m) return "";
  if (provider === "sample") return "";
  const owner = modelOwner(m);
  return owner && owner !== provider ? "" : m;
}
