import { resolveSecret } from "../secrets";
import { fetchJson, withRetry } from "./http";

/**
 * 제미나이 글 생성 — 주제 추천에 쓴다.
 *
 * 주소·요청 모양·응답 읽는 법은 이미지 생성(image.ts)이 쓰는 generateContent 와 같은 것을 그대로
 * 쓴다. 모델 이름은 코드에 박지 않는다 — 설정 화면에서 사용자가 넣은 값만 받는다.
 * 열쇠도 이미지 생성과 같은 Gemini 키(IMAGE_API_KEY, AIza…)를 함께 쓴다.
 */
export async function geminiComplete(req: { system: string; user: string; model: string; maxTokens?: number }): Promise<string> {
  const model = req.model.trim();
  if (!model) throw new Error("제미나이 모델 이름이 비어 있습니다. 설정 → AI 에서 넣어 주세요.");
  const key = resolveSecret("IMAGE_API_KEY");
  if (!key) throw new Error("Gemini API 키가 없습니다. 설정 → 이미지 생성에 Gemini 키를 넣어 주세요.");
  return withRetry("gemini", "topics", async () => {
    const out = await fetchJson<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(
      "gemini",
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: req.system }, { text: req.user }] }],
          generationConfig: { maxOutputTokens: req.maxTokens ?? 2000 },
        }),
      },
      120_000,
    );
    const text = (out.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text.trim()) throw new Error("빈 응답");
    return text;
  }, 2);
}
