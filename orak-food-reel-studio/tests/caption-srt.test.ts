import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("caption");
import { buildSampleCaption, buildHashtags } from "../src/lib/content/samplegen";
import { RestaurantInfoSchema } from "../src/lib/schema";
import { buildSrt, buildAss } from "../src/lib/pipeline/subtitles";

const info = RestaurantInfoSchema.parse({
  name: "봉천국밥", area: "봉천", address: "서울 관악구 봉천동",
  menus: [{ name: "돼지국밥", price: "8,000원", verified: true }],
});

describe("§24 Caption 생성", () => {
  it("본문에 📍매장명·주소·저장 CTA가 들어간다", () => {
    const caption = buildSampleCaption(info, "가성비 맛집");
    expect(caption).toContain("📍봉천국밥");
    expect(caption).toContain("서울 관악구 봉천동");
    expect(caption).toContain("저장");
  });
  it("해시태그는 5~12개, #오락푸드 포함", () => {
    const tags = buildHashtags(info);
    expect(tags.length).toBeGreaterThanOrEqual(5);
    expect(tags.length).toBeLessThanOrEqual(12);
    expect(tags).toContain("#오락푸드");
  });
});

const scenes = [
  { scene: 1, start: 0, end: 2.5, narration: "훅", subtitle: "6,000원 만두", visual_prompt: "", camera_motion: "slow_zoom_in" as const, character_presence: "none" as const, fact_source: "" },
  { scene: 2, start: 2.5, end: 6, narration: "본문", subtitle: "직접 확인해\n보겠습니다", visual_prompt: "", camera_motion: "static" as const, character_presence: "none" as const, fact_source: "" },
];

describe("§18 SRT/ASS 생성", () => {
  it("SRT 타임코드 형식이 올바르다", () => {
    const srt = buildSrt(scenes);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:02,500");
    expect(srt).toContain("6,000원 만두");
  });
  it("ASS에 한글 폰트 스타일과 줄바꿈(\\N)이 들어간다", () => {
    const ass = buildAss(scenes);
    expect(ass).toContain("Noto Sans KR ExtraBold");
    expect(ass).toContain("직접 확인해\\N보겠습니다");
  });
  it("가격 숫자는 강조색으로 감싼다", () => {
    const ass = buildAss(scenes);
    expect(ass).toMatch(/\{\\c&H[0-9A-F]+&?\}6,000원/);
  });
  it("엔딩 시그니처(사건 해결)를 넣을 수 있다", () => {
    const ass = buildAss(scenes, { endBadge: { from: 5, to: 6, text: "사건 해결" } });
    expect(ass).toContain("사건 해결");
    expect(ass).toContain("ORAK FOOD");
  });
});
