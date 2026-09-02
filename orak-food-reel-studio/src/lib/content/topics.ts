import { z } from "zod";
import { findCategory, type TopicCategory } from "./categories";
import { getLLM, extractJson } from "../providers/llm";
import { geminiComplete } from "../providers/llm-gemini";
import { getSettings } from "../settings";
import { isSampleMode, resolveSecret } from "../secrets";
import { logWarn } from "../log";

/**
 * 4대 분류 → 세부 주제 추천.
 *
 * 순서: 연습 모드면 예시 주제(AI 안 부름) → 제미나이 모델 이름과 Gemini 키가 있으면 제미나이
 *       → 아니면 기존 Claude → 그것도 없으면 예시 주제.
 * 어느 쪽이 답했는지(source)를 화면에 그대로 알린다 — 사용자가 "AI 가 고른 것" 과 "예시" 를 헷갈리지 않게.
 */

export const TOPIC_COUNT = 6;

export const TopicSuggestionSchema = z.object({
  /** 화면에 보이는 주제 이름 — 그대로 "콘텐츠 유형" 칸에 들어간다 */
  title: z.string().trim().min(2).max(40),
  /** 첫 2초 훅 한 줄 */
  hook: z.string().trim().max(60).default(""),
  /** 왜 지금 이 주제인지 한 줄 */
  why: z.string().trim().max(120).default(""),
});
export type TopicSuggestion = z.infer<typeof TopicSuggestionSchema>;

export type TopicSource = "gemini" | "claude" | "sample";

export interface TopicResult {
  category: TopicCategory;
  topics: TopicSuggestion[];
  source: TopicSource;
  /** 예시 주제로 대신한 이유 등 사용자에게 알릴 말 */
  notice?: string;
}

/** AI 에게 보내는 글 — 분류·지역·개수·JSON 모양을 못 박는다 */
export function buildTopicPrompt(cat: TopicCategory, area: string): { system: string; user: string } {
  const system = `당신은 오락푸드의 숏폼 콘텐츠 기획자다. 지역 맛집 릴스(9:16, 25초 안팎)의 세부 주제를 제안한다.
원칙:
- 실제 사람이 친구에게 알려주는 말투. 과장·클릭베이트 금지.
- 근거 없는 가게 이름·가격·수치를 지어내지 마라. 주제는 "어떤 이야기를 할지" 까지만.
- 주 시청자는 40~70대, 20~40대가 봐도 촌스럽지 않게.
- 반드시 JSON 만 출력한다. 설명문·코드펜스 없이.`;
  const user = `분류: ${cat.label} (${cat.hint})
지역: ${area}
이 분류에 맞는 세부 주제를 정확히 ${TOPIC_COUNT}개 제안하라.
각 주제는 title(2~40자, 주제 이름), hook(첫 2초 한 줄, 60자 이내), why(왜 지금 이 주제인지, 120자 이내) 를 가진다.
출력 형식: {"topics":[{"title":"...","hook":"...","why":"..."}]}`;
  return { system, user };
}

/** AI 응답 → 주제 목록. 배열이든 {topics:[…]} 든 받고, 잘못된 항목은 버리고, 같은 제목은 하나로 */
export function parseTopics(raw: string): TopicSuggestion[] {
  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(raw)); }
  catch { throw new Error("주제 추천 응답을 읽지 못했습니다. 다시 시도해 주세요."); }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray((parsed as { topics?: unknown }).topics))
      ? (parsed as { topics: unknown[] }).topics
      : null;
  if (!list) throw new Error("주제 추천 응답의 모양이 다릅니다. 다시 시도해 주세요.");
  const out: TopicSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const r = TopicSuggestionSchema.safeParse(item);
    if (!r.success) continue;
    const k = r.data.title.replace(/\s+/g, "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r.data);
    if (out.length >= TOPIC_COUNT) break;
  }
  if (out.length === 0) throw new Error("쓸 수 있는 주제가 없었습니다. 다시 시도해 주세요.");
  return out;
}

/** 연습 모드·키 없음 — 분류에 적힌 예시를 그대로 (매번 같아서 시험하기 쉽다) */
export function sampleTopics(cat: TopicCategory): TopicSuggestion[] {
  return cat.examples.slice(0, TOPIC_COUNT).map((title) => ({
    title, hook: `${title} — 오늘 바로 가 볼 수 있는 곳`, why: "연습 모드 예시 주제입니다. 실제 모드에서는 AI 가 지역·분류에 맞춰 새로 제안합니다.",
  }));
}

export async function recommendTopics(categoryKey: string, area = "신림 · 관악구"): Promise<TopicResult> {
  const category = findCategory(categoryKey);
  if (!category) throw new Error("알 수 없는 분류입니다.");

  if (isSampleMode()) {
    return { category, topics: sampleTopics(category), source: "sample", notice: "연습 모드라 예시 주제를 보여 줍니다." };
  }

  const { system, user } = buildTopicPrompt(category, area);
  const geminiModel = getSettings().topics.geminiModel.trim();
  const geminiKey = resolveSecret("IMAGE_API_KEY");
  if (geminiModel && geminiKey) {
    try {
      return { category, topics: parseTopics(await geminiComplete({ system, user, model: geminiModel })), source: "gemini" };
    } catch (e) {
      // 제미나이가 막혀도 추천 자체가 멈추면 안 된다 — Claude 로 넘어가되 이유는 남긴다
      logWarn("topics", `제미나이 추천 실패 — Claude 로 대신합니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (resolveSecret("ANTHROPIC_API_KEY")) {
    const text = await getLLM().complete({ system, user, task: "idea", maxTokens: 2000 });
    return {
      category, topics: parseTopics(text), source: "claude",
      notice: geminiModel && geminiKey ? "제미나이 응답이 없어 Claude 로 추천했습니다." : undefined,
    };
  }
  return {
    category, topics: sampleTopics(category), source: "sample",
    notice: "AI 키가 없어 예시 주제를 보여 줍니다. 설정에서 Claude 키 또는 Gemini 키 + 모델 이름을 넣으면 AI 가 추천합니다.",
  };
}
