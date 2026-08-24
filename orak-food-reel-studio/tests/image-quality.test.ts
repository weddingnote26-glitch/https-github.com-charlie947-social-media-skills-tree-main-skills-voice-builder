import { describe, it, expect } from "vitest";
import { tierFor, sceneKindOf, TIERS, POLICY_LABEL } from "../src/lib/providers/image-quality";

/**
 * 비용은 배경·음식에서 아끼고, 오락이 얼굴에서는 아끼지 않는다.
 * 캐릭터가 매번 달라 보이면 채널 정체성이 무너진다.
 */
describe("품질 등급 나누기", () => {
  it("어느 정책에서도 오락이는 최고 품질", () => {
    for (const p of ["cost_optimized", "balanced", "best"] as const) {
      expect(tierFor(p, "character"), p).toBe("high");
    }
  });

  it("비용 절약형은 배경을 가장 싸게 만든다", () => {
    expect(tierFor("cost_optimized", "background")).toBe("eco");
    expect(tierFor("cost_optimized", "food")).toBe("standard");
  });

  it("최고 품질형은 전부 올린다", () => {
    expect(tierFor("best", "food")).toBe("high");
    expect(tierFor("best", "background")).toBe("high");
  });

  it("등급이 올라갈수록 생성 단계와 크기가 커진다", () => {
    expect(TIERS.high.steps).toBeGreaterThan(TIERS.eco.steps);
    expect(TIERS.high.width).toBeGreaterThan(TIERS.eco.width);
    // 어떤 등급도 세로가 가로보다 길어야 한다 (9:16 릴스)
    for (const t of Object.values(TIERS)) expect(t.height).toBeGreaterThan(t.width);
    // 무한 재시도 금지
    for (const t of Object.values(TIERS)) expect(t.retries).toBeLessThanOrEqual(1);
  });
});

describe("장면 종류 가리기", () => {
  it("오락이가 나오면 캐릭터 장면", () => {
    for (const p of ["corner", "side", "hero"]) {
      expect(sceneKindOf({ character_presence: p }), p).toBe("character");
    }
  });

  it("오락이가 없고 음식 이야기면 음식 장면", () => {
    expect(sceneKindOf({ character_presence: "none", visual_prompt: "close-up of steaming dumplings" })).toBe("food");
    expect(sceneKindOf({ character_presence: "none", narration: "대표 메뉴는 김치만두입니다" })).toBe("food");
  });

  it("나머지는 배경 장면 (가장 싸게)", () => {
    expect(sceneKindOf({ character_presence: "none", visual_prompt: "quiet alley at dusk" })).toBe("background");
    expect(sceneKindOf({})).toBe("background");
  });

  it("화면에 보여줄 이름이 사람 말이다", () => {
    expect(POLICY_LABEL.cost_optimized).toContain("권장");
  });
});
