import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("env");
import { EnvSchema } from "../src/lib/env";
import { scoreQuality } from "../src/lib/pipeline/quality";
import { runFactCheck } from "../src/lib/pipeline/factcheck";
import { buildSampleScript } from "../src/lib/content/samplegen";
import { RestaurantInfoSchema } from "../src/lib/schema";
import { fieldStatus } from "../src/lib/pipeline/research";

describe("§41 환경변수 validation", () => {
  it("빈 환경에서도 기본값으로 동작한다 (Sample Mode)", () => {
    const env = EnvSchema.parse({});
    expect(env.APP_MODE).toBe("sample");
    expect(env.APP_PORT).toBe(3000);
  });
  it("잘못된 포트는 거부한다", () => {
    expect(() => EnvSchema.parse({ APP_PORT: "99999" })).toThrow();
  });
});

const infoVerified = RestaurantInfoSchema.parse({
  name: "신림곱창", area: "신림", address: "서울 관악구 신림동 1-1",
  menus: [{ name: "곱창", price: "12,000원", verified: true }],
  hours: "11:00~22:00",
});
infoVerified.field_status = fieldStatus(infoVerified);

describe("§26 팩트체크", () => {
  it("확인된 정보는 통과한다", () => {
    const script = buildSampleScript({ info: infoVerified, contentType: "가성비 맛집", contentMode: "ORAKI_DETECTIVE", duration: 25, caseNumber: 1 });
    const fact = runFactCheck(script, infoVerified);
    expect(fact.blocked).toBe(false);
  });
  it("미확인 가격이 대본에 있으면 차단한다", () => {
    const infoUnverified = RestaurantInfoSchema.parse({ name: "신림곱창", area: "신림" });
    infoUnverified.field_status = fieldStatus(infoUnverified);
    const script = buildSampleScript({ info: infoVerified, contentType: "가성비 맛집", contentMode: "ORAKI_DETECTIVE", duration: 25, caseNumber: 2 });
    const fact = runFactCheck(script, infoUnverified); // 대본엔 12,000원이 있는데 정보는 미확인
    expect(fact.blocked).toBe(true);
    expect(fact.blockReasons.join()).toContain("가격");
  });
  it("과장 건강 효능 표현을 차단한다", () => {
    const script = buildSampleScript({ info: infoVerified, contentType: "가성비 맛집", contentMode: "NORMAL_FOOD", duration: 25 });
    script.scenes[3].narration = "이 곱창은 피부에 좋습니다";
    const fact = runFactCheck(script, infoVerified);
    expect(fact.blocked).toBe(true);
  });
});

describe("§27 품질점수", () => {
  it("정상 대본은 80점 이상, 팩트 차단 시 감점된다", () => {
    const script = buildSampleScript({ info: infoVerified, contentType: "가성비 맛집", contentMode: "ORAKI_DETECTIVE", duration: 25, caseNumber: 3 });
    const good = scoreQuality(script, false, 7, 7);
    expect(good.total).toBeGreaterThanOrEqual(80);
    const blocked = scoreQuality(script, true, 3, 7);
    expect(blocked.total).toBeLessThan(good.total);
    expect(blocked.suggestions.length).toBeGreaterThan(0);
  });
  it("AI 티가 나는 표현은 감점 + 수정 제안", () => {
    const script = buildSampleScript({ info: infoVerified, contentType: "가성비 맛집", contentMode: "NORMAL_FOOD", duration: 25 });
    script.scenes[2].narration = "환상적인 미식 경험을 선사하는 곱창";
    const q = scoreQuality(script, false, 7, 7);
    expect(q.suggestions.join()).toContain("환상적인");
  });
});
