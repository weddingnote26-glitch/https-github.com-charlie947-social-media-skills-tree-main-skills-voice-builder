import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("normalize");
import {
  normalizeScriptDraft, normalizeCameraMotion, normalizeAction,
  normalizeExpression, normalizePresence,
} from "../src/lib/content/normalize";
import { ReelScriptSchema } from "../src/lib/schema";

const CTX = {
  contentType: "가성비 맛집",
  contentMode: "ORAKI_DETECTIVE" as const,
  duration: 25,
  caseNumber: 7,
  restaurantName: "신림동 오첨지",
};

describe("허용값 밖의 AI 출력 보정", () => {
  it("camera_motion: 목록 밖 값을 의미에 맞게 맞춘다", () => {
    expect(normalizeCameraMotion("zoom_in")).toBe("slow_zoom_in");
    expect(normalizeCameraMotion("close-up")).toBe("slow_zoom_in");
    expect(normalizeCameraMotion("tilt up")).toBe("push_up");
    expect(normalizeCameraMotion("dolly right")).toBe("pan_right");
  });
  it("camera_motion: 도저히 못 맞추면 static 으로 떨어진다", () => {
    expect(normalizeCameraMotion("handheld shaky cam")).toBe("static");
    expect(normalizeCameraMotion(undefined)).toBe("static");
    expect(normalizeCameraMotion(42)).toBe("static");
  });
  it("character_action: 비슷한 한국어를 목록 값으로 맞춘다", () => {
    expect(normalizeAction("음식 가리키기")).toBe("손가락으로 음식 가리키기");
    expect(normalizeAction("돋보기로 관찰하기")).toBe("돋보기로 음식 관찰");
    expect(normalizeAction("걷기")).toBe("걷기");
    expect(normalizeAction("점프하기")).toBeNull();
    expect(normalizeAction(null)).toBeNull();
  });
  it("expression / presence 도 안전한 기본값이 있다", () => {
    expect(normalizeExpression("shocked!")).toBe("Shocked");
    expect(normalizeExpression("알수없음")).toBe("Neutral");
    expect(normalizePresence("배경")).toBe("none");
    expect(normalizePresence("hero")).toBe("hero");
  });
});

describe("실제 실패 사례 재현 — 보정 후 검증 통과", () => {
  /** 사용자 로그와 같은 형태: enum 밖 camera_motion + 시간 불연속 */
  const brokenDraft = {
    title: "맛집사건 #007",
    restaurant: "신림동 오첨지",
    hook: "신림에 수상한 집이 있습니다.",
    duration: 25,
    content_mode: "ORAKI_DETECTIVE",
    content_type: "가성비 맛집",
    scenes: [
      { scene: 1, start: 0, end: 2.5, narration: "가", subtitle: "가", visual_prompt: "p", camera_motion: "zoom_in", character_action: "골목 살펴보기", character_expression: "Suspicious", character_presence: "side", fact_source: "" },
      { scene: 2, start: 9, end: 12, narration: "나", subtitle: "나", visual_prompt: "p", camera_motion: "close-up", character_action: "음식 가리키기", character_expression: "excited", character_presence: "코너", fact_source: "" },
      { scene: 3, start: 12, end: 15, narration: "다", subtitle: "다", visual_prompt: "p", camera_motion: "handheld", character_action: "점프하기", character_expression: "???", character_presence: "none", fact_source: "" },
      { scene: 4, start: 15, end: 19, narration: "라", subtitle: "라", visual_prompt: "p", camera_motion: "static", character_action: "한입 먹기", character_expression: "Shocked", character_presence: "side", fact_source: "" },
      { scene: 5, start: 19, end: 24, narration: "마", subtitle: "마", visual_prompt: "p", camera_motion: "pan_right", character_action: "사건 해결 포즈", character_expression: "Satisfied", character_presence: "corner", fact_source: "" },
    ],
    caption: "본문",
    hashtags: ["신림맛집"],
    cta: "저장해두세요.",
  };

  it("보정 전에는 Zod 검증에서 거부된다", () => {
    expect(() => ReelScriptSchema.parse(brokenDraft)).toThrow();
  });

  it("보정 후에는 검증을 통과한다", () => {
    const fixed = ReelScriptSchema.parse(normalizeScriptDraft(brokenDraft, CTX));
    expect(fixed.scenes[0].camera_motion).toBe("slow_zoom_in");
    expect(fixed.scenes[1].camera_motion).toBe("slow_zoom_in");
    expect(fixed.scenes[2].camera_motion).toBe("static");
    expect(fixed.scenes[1].character_action).toBe("손가락으로 음식 가리키기");
    expect(fixed.scenes[2].character_action).toBeNull();
    expect(fixed.scenes[1].character_presence).toBe("corner");
    expect(fixed.case_number).toBe(7);
    expect(fixed.verdict?.label).toBe("오락이 탐정 판정");
    expect(fixed.hashtags.length).toBeGreaterThanOrEqual(3);
  });

  it("장면 시간이 끊겨 있어도 처음부터 이어붙여 고친다", () => {
    const fixed = ReelScriptSchema.parse(normalizeScriptDraft(brokenDraft, CTX));
    expect(fixed.scenes[0].start).toBe(0);
    for (let i = 1; i < fixed.scenes.length; i++) {
      expect(fixed.scenes[i].start).toBeCloseTo(fixed.scenes[i - 1].end, 1);
    }
    const total = fixed.scenes[fixed.scenes.length - 1].end;
    expect(Math.abs(total - fixed.duration)).toBeLessThanOrEqual(3);
  });

  it("장면이 통째로 비어 있는 등 회복 불가면 여전히 거부한다(무한 통과 방지)", () => {
    expect(() => ReelScriptSchema.parse(normalizeScriptDraft({ scenes: [] }, CTX))).toThrow();
  });
});
