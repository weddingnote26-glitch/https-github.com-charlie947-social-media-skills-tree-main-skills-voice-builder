import { describe, it, expect, vi, afterEach } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("topics");
import { TOPIC_CATEGORIES, findCategory } from "../src/lib/content/categories";
import { buildTopicPrompt, parseTopics, sampleTopics, recommendTopics, TOPIC_COUNT } from "../src/lib/content/topics";
import { geminiComplete } from "../src/lib/providers/llm-gemini";
import { resetEnvCache } from "../src/lib/env";
import { getSettings, saveSettings } from "../src/lib/settings";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });

describe("4대 분류", () => {
  it("네 분류가 있고 키가 겹치지 않는다", () => {
    expect(TOPIC_CATEGORIES.map((c) => c.label)).toEqual(["일상 · 관계", "동네 · 맛집", "생활 취미", "오락 브랜딩 (소개)"]);
    expect(new Set(TOPIC_CATEGORIES.map((c) => c.key)).size).toBe(4);
    for (const c of TOPIC_CATEGORIES) expect(c.examples.length).toBeGreaterThanOrEqual(4);
  });
  it("키로 찾는다 — 없으면 undefined", () => {
    expect(findCategory("town")?.label).toBe("동네 · 맛집");
    expect(findCategory(" brand ")?.key).toBe("brand");
    expect(findCategory("없음")).toBeUndefined();
  });
});

describe("AI 응답 읽기", () => {
  it("{topics:[…]} 도, 배열도, 코드펜스도 받는다", () => {
    const one = parseTopics('{"topics":[{"title":"주말 밥집","hook":"h","why":"w"}]}');
    expect(one).toEqual([{ title: "주말 밥집", hook: "h", why: "w" }]);
    expect(parseTopics('[{"title":"골목 식당"}]')[0]).toEqual({ title: "골목 식당", hook: "", why: "" });
    expect(parseTopics('설명입니다\n```json\n[{"title":"빵집 순례"}]\n```')[0].title).toBe("빵집 순례");
  });
  it("잘못된 항목은 버리고, 같은 제목은 하나로, 개수는 상한까지", () => {
    const dup = parseTopics(JSON.stringify({ topics: [{ title: "같은 주제" }, { title: "같은  주제" }, { title: "같은 주제" }, { title: "다른 주제" }] }));
    expect(dup.map((t) => t.title)).toEqual(["같은 주제", "다른 주제"]); // 띄어쓰기만 다른 것도 하나로
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `주제 ${i}` }));
    const out = parseTopics(JSON.stringify({ topics: [{ title: "x" }, { nope: 1 }, ...many] }));
    expect(out.length).toBe(TOPIC_COUNT);
    expect(out.some((t) => t.title === "x")).toBe(false); // 두 글자 미만은 버린다
  });
  it("읽을 수 없으면 사용자 말로 오류", () => {
    expect(() => parseTopics("이건 JSON 아님")).toThrow(/읽지 못했습니다/);
    expect(() => parseTopics('{"foo":1}')).toThrow(/모양이 다릅니다/);
    expect(() => parseTopics('{"topics":[{"nope":1}]}')).toThrow(/쓸 수 있는 주제가 없었습니다/);
  });
});

describe("프롬프트·예시", () => {
  it("분류·지역·개수·JSON 모양이 글에 들어간다", () => {
    const cat = findCategory("hobby")!;
    const { system, user } = buildTopicPrompt(cat, "신림");
    expect(user).toContain(cat.label);
    expect(user).toContain("신림");
    expect(user).toContain(`${TOPIC_COUNT}개`);
    expect(user).toContain('"topics"');
    expect(system).toContain("JSON");
  });
  it("예시 주제는 매번 같다 (연습 모드)", () => {
    const cat = findCategory("brand")!;
    expect(sampleTopics(cat)).toEqual(sampleTopics(cat));
    expect(sampleTopics(cat).length).toBeGreaterThanOrEqual(4);
  });
});

describe("추천 흐름", () => {
  it("연습 모드에서는 키가 있어도 AI 를 부르지 않고 예시를 준다", async () => {
    // 키를 일부러 넣어 둔다 — 연습 모드 우회가 없으면 Claude 를 부르게 되고, 그러면 이 시험이 잡는다
    vi.stubEnv("APP_MODE", "sample"); vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test"); resetEnvCache();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const r = await recommendTopics("town");
    expect(r.source).toBe("sample");
    expect(r.topics.map((t) => t.title)).toContain("동네에 새로 생긴 맛집 추가");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("모르는 분류는 오류", async () => {
    await expect(recommendTopics("없는분류")).rejects.toThrow(/알 수 없는 분류/);
  });
  it("실제 모드 + 제미나이 모델·키가 있으면 제미나이로 (주소에 모델, 본문에 분류)", async () => {
    vi.stubEnv("APP_MODE", "live"); vi.stubEnv("IMAGE_API_KEY", "AIza-test-key"); vi.stubEnv("ANTHROPIC_API_KEY", ""); resetEnvCache();
    saveSettings({ topics: { geminiModel: "my-gemini-model" } });
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"topics":[{"title":"제미나이 주제","hook":"h","why":"w"}]}' }] } }] }), { status: 200 });
    }));
    try {
      const r = await recommendTopics("daily", "봉천");
      expect(r.source).toBe("gemini");
      expect(r.topics[0].title).toBe("제미나이 주제");
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("/models/my-gemini-model:generateContent");
      expect(calls[0].url).toContain("key=AIza-test-key");
      expect(calls[0].body).toContain("일상 · 관계");
      expect(calls[0].body).toContain("봉천");
    } finally {
      saveSettings({ topics: { geminiModel: "" } });
    }
  });
  it("제미나이 모델이 비어 있으면 Claude 로", async () => {
    vi.stubEnv("APP_MODE", "live"); vi.stubEnv("IMAGE_API_KEY", "AIza-test-key"); vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test"); resetEnvCache();
    expect(getSettings().topics.geminiModel).toBe("");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ content: [{ type: "text", text: '[{"title":"클로드 주제"}]' }] }), { status: 200 });
    }));
    const r = await recommendTopics("hobby");
    expect(r.source).toBe("claude");
    expect(r.topics[0].title).toBe("클로드 주제");
    expect(calls[0]).toContain("api.anthropic.com");
  });
  it("실제 모드인데 키가 하나도 없으면 예시 + 안내", async () => {
    vi.stubEnv("APP_MODE", "live"); vi.stubEnv("IMAGE_API_KEY", ""); vi.stubEnv("ANTHROPIC_API_KEY", ""); resetEnvCache();
    const r = await recommendTopics("brand");
    expect(r.source).toBe("sample");
    expect(r.notice).toMatch(/키가 없어/);
  });
});

describe("제미나이 글 생성", () => {
  it("모델 이름이 없으면 부르지 않는다", async () => {
    vi.stubEnv("IMAGE_API_KEY", "AIza-x"); resetEnvCache();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(geminiComplete({ system: "s", user: "u", model: "  " })).rejects.toThrow(/모델 이름/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("빈 응답은 오류다", async () => {
    vi.stubEnv("IMAGE_API_KEY", "AIza-x"); resetEnvCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })));
    await expect(geminiComplete({ system: "s", user: "u", model: "m" })).rejects.toThrow(/빈 응답/);
  });
});
