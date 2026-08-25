/**
 * 이미지 모델 이름 규칙 — 무거운 의존성 없이 쓰려고 따로 뒀다.
 * (설정 저장 API와 이미지 공급자가 같은 규칙을 공유한다)
 */

/** 모델 이름이 어느 공급자 것인지 */
export function modelOwner(model: string): "gemini" | "openai" | "cloudflare" | null {
  const k = model.toLowerCase();
  if (k.startsWith("@cf/")) return "cloudflare";
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
  provider: "gemini" | "openai" | "cloudflare",
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
  provider: "gemini" | "openai" | "cloudflare" | "sample",
  model: string | undefined,
): string {
  const m = (model ?? "").trim();
  if (!m) return "";
  if (provider === "sample") return "";
  const owner = modelOwner(m);
  return owner && owner !== provider ? "" : m;
}

/**
 * 저장된 키가 저장된 공급자와 아예 다른 종류인 경우.
 * 화면에서 공급자를 바꾸고 [저장]을 누르지 않으면 여기서 걸린다 —
 * 그때 "키가 틀렸다"고만 하면 멀쩡한 키를 계속 다시 발급받게 된다.
 */
export function imageKeyMismatch(provider: string, key: string): string | null {
  if (provider === "gemini" && key.startsWith("sk-")) {
    return "저장된 키는 OpenAI 키(sk-…)인데 공급자가 Gemini 로 저장되어 있습니다. 위 [공급자]를 'OpenAI 이미지'로 바꾸면 자동으로 저장됩니다.";
  }
  if (provider === "openai" && key.startsWith("AIza")) {
    return "저장된 키는 Gemini 키(AIza…)인데 공급자가 OpenAI 로 저장되어 있습니다. 위 [공급자]를 'Gemini / Imagen'으로 바꾸거나 OpenAI 키를 넣으세요.";
  }
  return null;
}
