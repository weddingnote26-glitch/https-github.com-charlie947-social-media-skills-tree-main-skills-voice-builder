import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("character");
import fs from "node:fs";
import { masterReferenceStatus, resolvedReferencePaths, orakiImagePrompt, caseLabel, pickVerdictPhrase, ORAKI } from "../src/lib/character/oraki";
import { saveSettings } from "../src/lib/settings";

describe("§14 Master Reference", () => {
  it("기준 이미지 7종이 모두 저장소에 준비돼 있다", () => {
    const status = masterReferenceStatus();
    expect(status).toHaveLength(7);
    for (const s of status) {
      expect(s.exists, `${s.file} 이 없습니다`).toBe(true);
      expect(fs.statSync(s.path).size).toBeGreaterThan(10000);
    }
  });

  it("사용자가 고른 참조가 없으면 기본 Master Reference를 자동 사용한다", () => {
    const paths = resolvedReferencePaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.length).toBeLessThanOrEqual(3);
    expect(paths.some((p) => p.endsWith("character_sheet.png"))).toBe(true);
  });

  it("고른 이미지가 사라져도 기본 Master Reference 로 되돌아간다", () => {
    // 실제로 겪은 일: 보관함 밖에서 파일을 지우면 설정에는 이름만 남는다.
    // 그때 참조를 하나도 넘기지 않으면 오락이 얼굴이 장면마다 달라진다.
    saveSettings({ characterLock: { enabled: true, seed: 1, referenceImages: ["없는파일_오락이.png"], assetRoot: "" } });
    const paths = resolvedReferencePaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => fs.existsSync(p))).toBe(true);
    saveSettings({ characterLock: { enabled: true, seed: 20260823, referenceImages: [], assetRoot: "" } });
  });

  it("Character Lock을 끄면 참조를 넘기지 않는다", () => {
    saveSettings({ characterLock: { enabled: false, seed: 1, referenceImages: [], assetRoot: "" } });
    expect(resolvedReferencePaths()).toEqual([]);
    saveSettings({ characterLock: { enabled: true, seed: 20260823, referenceImages: [], assetRoot: "" } });
    expect(resolvedReferencePaths().length).toBeGreaterThan(0);
  });
});

describe("§15~21 캐릭터 프롬프트 규칙", () => {
  it("음식이 주인공인 장면(none)에는 캐릭터를 넣지 않는다", () => {
    const p = orakiImagePrompt({ sceneDescription: "국밥 클로즈업", presence: "none" });
    expect(p).toContain("Do not include the character");
    expect(p).not.toContain("dumpling detective named Oraki");
  });

  it("corner 장면은 20% 미만, side 장면은 35% 미만으로 제한한다", () => {
    expect(orakiImagePrompt({ sceneDescription: "s", presence: "corner" })).toContain("less than 20%");
    expect(orakiImagePrompt({ sceneDescription: "s", presence: "side" })).toContain("less than 35%");
  });

  it("18cm 크기·브랜드 컬러·텍스트 금지·레퍼런스 고정이 프롬프트에 항상 들어간다", () => {
    const p = orakiImagePrompt({ sceneDescription: "s", presence: "side", action: "한입 먹기", expression: "Shocked" });
    expect(p).toContain(`${ORAKI.heightCm}cm`);
    expect(p).toContain("#E86A3A");
    expect(p).toContain("Do not generate any text in the image");
    expect(p).toContain("reference character sheet");
    expect(p).toContain("한입 먹기");
    // §22 먹는 장면이 기괴해지지 않도록
    expect(p).toContain("never opens unnaturally wide");
  });
});

describe("§9~11 사건번호 · 탐정 판정", () => {
  it("사건번호는 세 자리로 표기한다", () => {
    expect(caseLabel(7)).toBe("맛집사건 #007");
    expect(caseLabel(142)).toBe("맛집사건 #142");
  });
  it("콘텐츠 유형에 맞는 판정 문구를 고른다", () => {
    const phrase = pickVerdictPhrase("혼밥 맛집", 0);
    expect(typeof phrase).toBe("string");
    expect(phrase.length).toBeGreaterThan(3);
  });
});
