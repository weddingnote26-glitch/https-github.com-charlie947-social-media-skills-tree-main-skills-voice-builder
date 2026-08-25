import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("schema");
import { ReelScriptSchema, RestaurantInfoSchema } from "../src/lib/schema";
import { buildSampleScript } from "../src/lib/content/samplegen";

const info = RestaurantInfoSchema.parse({
  name: "신림골목만두", area: "신림", address: "서울 관악구",
  menus: [{ name: "고기만두", price: "6,000원", verified: true }],
});

describe("§56 릴스 JSON 검증", () => {
  it("샘플 대본(오락이 모드)이 Zod 검증을 통과한다", () => {
    const script = buildSampleScript({ info, contentType: "가성비 맛집", contentMode: "ORAKI_DETECTIVE", duration: 25, caseNumber: 7 });
    const parsed = ReelScriptSchema.parse(script);
    expect(parsed.case_number).toBe(7);
    expect(parsed.verdict?.label).toBe("오락이 탐정 판정");
    expect(parsed.scenes.length).toBeGreaterThanOrEqual(5);
  });

  it("샘플 대본(일반 모드)도 통과한다", () => {
    const script = buildSampleScript({ info, contentType: "혼밥 맛집", contentMode: "NORMAL_FOOD", duration: 25 });
    expect(() => ReelScriptSchema.parse(script)).not.toThrow();
  });

  it("장면 시간이 이어지지 않으면 거부한다", () => {
    const script = buildSampleScript({ info, contentType: "가성비 맛집", contentMode: "NORMAL_FOOD", duration: 25 });
    script.scenes[2].start += 5; // 시간 구멍
    expect(() => ReelScriptSchema.parse(script)).toThrow();
  });

  it("오락이 모드에 verdict가 없으면 거부한다", () => {
    const script = buildSampleScript({ info, contentType: "가성비 맛집", contentMode: "ORAKI_DETECTIVE", duration: 25, caseNumber: 1 });
    (script as { verdict: unknown }).verdict = null;
    expect(() => ReelScriptSchema.parse(script)).toThrow();
  });
});

describe("Scene 생성 규칙", () => {
  it("음식 핵심 장면(결정적 증거)은 캐릭터 없이 만든다 — 음식 60% 원칙", () => {
    const script = buildSampleScript({ info, contentType: "가성비 맛집", contentMode: "ORAKI_DETECTIVE", duration: 25, caseNumber: 2 });
    const evidence = script.scenes[4]; // 결정적 증거
    expect(evidence.character_presence).toBe("none");
  });
  it("모든 장면의 자막은 줄당 16자 이하다", () => {
    const script = buildSampleScript({ info, contentType: "가성비 맛집", contentMode: "ORAKI_DETECTIVE", duration: 25, caseNumber: 3 });
    for (const s of script.scenes) {
      for (const line of s.subtitle.split("\n")) expect(line.length).toBeLessThanOrEqual(16);
    }
  });
});
