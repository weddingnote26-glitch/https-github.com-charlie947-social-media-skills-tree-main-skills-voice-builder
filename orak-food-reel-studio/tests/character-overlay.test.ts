import { describe, it, expect } from "vitest";
import { planCharacterOverlays, poseFor, cutoutFor } from "../src/lib/pipeline/character-overlay";
import { buildRenderArgs } from "../src/lib/pipeline/render";
import type { Scene } from "../src/lib/schema";

const mk = (n: number, presence: Scene["character_presence"], action?: Scene["character_action"]): Scene => ({
  scene: n, start: (n - 1) * 3, end: n * 3,
  narration: "문장", subtitle: "자막", visual_prompt: "korean restaurant",
  camera_motion: "slow_zoom_in", character_presence: presence,
  character_action: action ?? null, fact_source: "",
});

describe("오락이 합성 — AI 에 기대지 않고 우리가 얹는다", () => {
  it("배경 투명 컷아웃이 프로그램에 들어 있다", () => {
    expect(cutoutFor("front")).toBeTruthy();
  });

  it("캐릭터가 있는 장면만 계획에 들어간다", () => {
    const plan = planCharacterOverlays([mk(1, "hero"), mk(2, "none"), mk(3, "corner")]);
    expect(plan.map((p) => p.scene)).toEqual([1, 3]);
  });

  it("캐릭터가 하나도 없으면 빈 계획", () => {
    expect(planCharacterOverlays([mk(1, "none"), mk(2, "none")])).toEqual([]);
  });

  it("hero 가 corner 보다 크게 선다", () => {
    const [hero] = planCharacterOverlays([mk(1, "hero")]);
    const [corner] = planCharacterOverlays([mk(1, "corner")]);
    expect(hero.height).toBeGreaterThan(corner.height);
  });

  it("화면(1080×1920) 밖으로 나가지 않는다", () => {
    for (const pr of ["hero", "side", "corner"] as const) {
      const [p] = planCharacterOverlays([mk(1, pr)]);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height).toBeLessThanOrEqual(1920);
    }
  });

  it("자막 자리를 침범하지 않는다 (발이 자막 위에 온다)", () => {
    const [p] = planCharacterOverlays([mk(1, "hero")]);
    expect(p.y + p.height).toBeLessThanOrEqual(1920 - Math.round(1920 * 0.30) + 1);
  });

  it("장면 시간과 같은 구간에만 나온다", () => {
    const [p] = planCharacterOverlays([mk(2, "side")]);
    expect(p.start).toBe(3);
    expect(p.end).toBe(6);
  });

  it("걷는 장면은 옆모습을 쓴다", () => {
    expect(poseFor(mk(1, "side", "걷기"))).toBe("side");
    expect(poseFor(mk(1, "hero", "엄지척"))).toBe("front");
  });

  it("좌우를 번갈아 세워 정지 화면처럼 보이지 않게 한다", () => {
    const plan = planCharacterOverlays([mk(1, "corner"), mk(2, "corner"), mk(3, "corner")]);
    const xs = plan.map((p) => p.x);
    expect(new Set(xs).size).toBeGreaterThan(1);
  });
});

describe("합성이 실제 ffmpeg 명령에 들어간다", () => {
  const scenes = [mk(1, "hero"), mk(2, "none")];
  const imageByScene = new Map([[1, "/tmp/a.jpg"], [2, "/tmp/b.jpg"]]);
  const base = { scenes, imageByScene, voicePath: null, assPath: "/tmp/s.ass", outPath: "/tmp/out.mp4" };

  it("캐릭터 PNG 가 입력으로 들어간다", () => {
    const plan = planCharacterOverlays(scenes);
    const { args } = buildRenderArgs({ ...base, characters: plan });
    expect(args.filter((a) => a === "-i").length).toBeGreaterThanOrEqual(scenes.length + 1 + plan.length);
    expect(args.some((a) => a.includes("cutout"))).toBe(true);
  });

  it("overlay 필터가 장면 시간에만 켜진다", () => {
    const plan = planCharacterOverlays(scenes);
    const { args } = buildRenderArgs({ ...base, characters: plan });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("overlay=");
    expect(fc).toContain("enable='between(t,0.00,3.00)'");
  });

  it("자막이 캐릭터 위에 그려진다 (글이 가려지지 않게)", () => {
    const plan = planCharacterOverlays(scenes);
    const { args } = buildRenderArgs({ ...base, characters: plan });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc.indexOf("overlay=")).toBeLessThan(fc.indexOf("subtitles="));
  });

  it("캐릭터가 없으면 예전과 같은 명령을 만든다 (기존 영상에 영향 없음)", () => {
    const withNone = buildRenderArgs({ ...base, characters: [] });
    const without = buildRenderArgs(base);
    expect(withNone.args).toEqual(without.args);
  });
});
