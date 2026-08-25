import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("samplegen-guard");
import { buildSampleScript, buildSampleCaption, buildHashtags } from "../src/lib/content/samplegen";
import { slugify } from "../src/lib/id";
import type { RestaurantInfo } from "../src/lib/schema";

/**
 * 실제로 겪은 일: 제작이 "Cannot read properties of undefined (reading 'replace')"
 * 로 멈췄다. 대본 만들기는 값이 조금 비어 있다고 통째로 멈출 일이 아니다.
 * 빠진 값은 그럴듯한 기본값으로 메우고 계속 간다.
 */
const bare = { name: "신림동 만두명가", menus: [] } as unknown as RestaurantInfo;

describe("값이 비어도 대본 만들기가 멈추지 않는다", () => {
  it("지역이 없어도 만든다", () => {
    expect(() => buildHashtags(bare)).not.toThrow();
    expect(buildHashtags(bare)[0]).toContain("맛집");
  });

  it("메뉴 목록 자체가 없어도 만든다", () => {
    const noMenus = { name: "가게", area: "신림" } as unknown as RestaurantInfo;
    expect(() => buildHashtags(noMenus)).not.toThrow();
    expect(() => buildSampleCaption(noMenus, "가성비 맛집")).not.toThrow();
  });

  it("콘텐츠 유형이 비어도 캡션을 만든다", () => {
    const cap = buildSampleCaption(bare, undefined as unknown as string);
    expect(cap).toContain("신림동 만두명가");
    expect(cap).not.toContain("undefined");
  });

  it("대본 전체를 빈 값으로 만들어도 터지지 않는다", () => {
    const script = buildSampleScript({
      info: bare, contentType: undefined as unknown as string,
      contentMode: "ORAKI_DETECTIVE", duration: 25, caseNumber: 1,
    });
    expect(script.scenes.length).toBeGreaterThan(4);
    // 자막이 "undefined" 라는 글자로 영상에 박히면 안 된다
    for (const sc of script.scenes) expect(sc.subtitle).not.toContain("undefined");
  });

  it("폴더 이름 만들기도 빈 값을 견딘다", () => {
    expect(slugify(undefined as unknown as string)).toBe("reel");
    expect(slugify("신림동 만두명가")).toBeTruthy();
  });
});
