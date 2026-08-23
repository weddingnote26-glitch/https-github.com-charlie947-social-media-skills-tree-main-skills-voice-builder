import { getEnv } from "../env";
import { fetchJson, withRetry } from "./http";
import type { LLMProvider, LLMTask } from "./types";
import { sampleComplete } from "../content/samplegen";

class AnthropicLLM implements LLMProvider {
  readonly name = "anthropic";
  async complete(req: { system: string; user: string; task: LLMTask; maxTokens?: number }): Promise<string> {
    const env = getEnv();
    return withRetry("anthropic", req.task, async () => {
      const out = await fetchJson<{ content: Array<{ type: string; text?: string }> }>(
        "anthropic",
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: env.ANTHROPIC_MODEL,
            max_tokens: req.maxTokens ?? 4000,
            system: req.system,
            messages: [{ role: "user", content: req.user }],
          }),
        },
      );
      const text = out.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      if (!text.trim()) throw new Error("빈 응답");
      return text;
    });
  }
}

/** Sample Mode — API 키 없이 전체 흐름 시험 (§50). 결정적 로컬 생성기 사용 */
class SampleLLM implements LLMProvider {
  readonly name = "sample";
  async complete(req: { system: string; user: string; task: LLMTask; context?: unknown }): Promise<string> {
    return sampleComplete(req.task, req.context);
  }
}

export function getLLM(): LLMProvider {
  const env = getEnv();
  if (env.APP_MODE === "sample" || !env.ANTHROPIC_API_KEY) return new SampleLLM();
  return new AnthropicLLM();
}

/** LLM 응답에서 JSON 블록 추출 (코드펜스/설명문 방어) */
export function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.search(/[[{]/);
  if (start >= 0) {
    // 마지막 닫힘 괄호까지
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (end > start) return text.slice(start, end + 1);
  }
  return text.trim();
}
