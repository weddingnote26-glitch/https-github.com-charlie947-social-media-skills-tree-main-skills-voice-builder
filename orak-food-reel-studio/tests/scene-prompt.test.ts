import { describe, it, expect } from "vitest";
import {
  buildScenePrompt, scenePromptIssues, localeHint, KOREAN_SCENE_NEGATIVE, koreanNegativeAsRules,
} from "../src/lib/content/scene-prompt";

describe("이미지 프롬프트 — 한국 배경 + 글자 없는 간판", () => {
  const base = "a bowl of hot noodle soup on a wooden table";

  it("장면 내용을 지우지 않고 조건만 덧붙인다", () => {
    const out = buildScenePrompt({ visualPrompt: base });
    expect(out).toContain(base);
  });

  it("언제나 한국이라는 조건이 들어간다", () => {
    expect(buildScenePrompt({ visualPrompt: base })).toContain("South Korea");
  });

  it("업체 주소가 있으면 그 동네를 넣는다", () => {
    const out = buildScenePrompt({ visualPrompt: base, address: "서울 관악구 신림로 123 2층" });
    expect(out).toContain("서울 관악구 신림로");
  });

  it("주소가 없으면 지역만이라도 쓴다", () => {
    expect(buildScenePrompt({ visualPrompt: base, area: "관악구" })).toContain("관악구");
  });

  it("주소도 지역도 없으면 기본 한국 조건만 — 빈 값을 억지로 넣지 않는다", () => {
    const out = buildScenePrompt({ visualPrompt: base });
    expect(out).toContain("South Korea");
    expect(out).not.toContain("specifically");
  });

  it("간판·메뉴판을 빈 판으로 그리게 한다 (핵심 규칙)", () => {
    const out = buildScenePrompt({ visualPrompt: base });
    expect(out).toContain("blank signboard without any text");
    expect(out).toContain("empty menu board with no letters");
    expect(out).toContain("no lettering anywhere in the image");
  });

  it("negative 를 못 받는 공급자에는 금지 규칙을 본문에 넣는다", () => {
    const out = buildScenePrompt({ visualPrompt: base, supportsNegative: false });
    expect(out).toContain("STRICTLY AVOID");
    expect(out).toContain("gibberish letters");
  });

  it("negative 를 받는 공급자에는 본문을 짧게 둔다", () => {
    const out = buildScenePrompt({ visualPrompt: base, supportsNegative: true });
    expect(out).not.toContain("STRICTLY AVOID");
  });

  it("금지 목록에 실제로 겪은 문제들이 모두 들어 있다", () => {
    for (const banned of [
      "English sign", "Japanese text", "Chinese text",   // 외국어 간판
      "gibberish letters", "garbled hangul",             // 깨진·가짜 글자
      "American diner", "Japanese izakaya",              // 외국 배경
      "dollar price", "yen price", "yuan price",         // 외국 통화
    ]) {
      expect(KOREAN_SCENE_NEGATIVE).toContain(banned);
    }
  });

  it("금지 문장은 AVOID 로 시작해 모델이 헷갈리지 않게 한다", () => {
    expect(koreanNegativeAsRules().startsWith("STRICTLY AVOID:")).toBe(true);
  });

  it("규칙이 빠진 프롬프트는 스스로 잡아낸다", () => {
    expect(scenePromptIssues("just a plain noodle photo")).toEqual([
      "한국이라는 조건이 빠졌습니다",
      "간판을 빈 판으로 그리라는 조건이 빠졌습니다",
    ]);
    expect(scenePromptIssues(buildScenePrompt({ visualPrompt: base }))).toEqual([]);
  });

  it("주소는 앞 세 덩어리만 쓴다 — 상세주소까지 넣으면 배경이 산만해진다", () => {
    expect(localeHint(null, "서울 관악구 신림동 1234-5 지하 1층 오락빌딩")).toBe("서울 관악구 신림동");
    expect(localeHint("", "")).toBe("");
  });
});
