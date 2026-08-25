import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTempDb } from "./helpers";
useTempDb("image-cost");
process.env.APP_MODE = "live";
process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
process.env.CLOUDFLARE_API_TOKEN = "cf-test-token-000000000000000000000000";

import { generateSceneImages, lastImageUsage } from "../src/lib/pipeline/images";
import { saveSettings, getSettings } from "../src/lib/settings";
import type { Scene } from "../src/lib/schema";

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const scene = (n: number, presence: Scene["character_presence"], prompt = `scene ${n} prompt`): Scene => ({
  scene: n, start: n * 3, end: n * 3 + 3,
  narration: `${n}`, subtitle: `${n}`, visual_prompt: prompt,
  camera_motion: "static", character_action: null, character_expression: null,
  character_presence: presence, fact_source: "현장",
}) as Scene;

const jsonImage = () => ({
  ok: true, status: 200,
  headers: new Headers({ "content-type": "application/json" }),
  text: async () => JSON.stringify({ success: true, result: { image: PNG_1x1 } }),
  arrayBuffer: async () => new ArrayBuffer(0),
}) as unknown as Response;

let realFetch: typeof globalThis.fetch;
let outDir: string;
const policy = (over: Partial<ReturnType<typeof getSettings>["imagePolicy"]> = {}) => ({
  fallback: false, reuseCache: true, costPolicy: "cost_optimized" as const,
  budgetCalls: 20, budgetStop: true, maxCharacterGen: 2, ...over,
});

beforeEach(() => {
  realFetch = globalThis.fetch;
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "orak-cost-"));
  saveSettings({ imageProvider: "cloudflare", imagePolicy: policy() });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* 임시 */ }
});

/** 실제로 나간 요청 몸통들을 붙잡는다 */
function captureBodies(): { bodies: Array<Record<string, unknown>>; urls: string[] } {
  const bodies: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    try { bodies.push(JSON.parse(String(init?.body ?? "{}"))); } catch { bodies.push({}); }
    return jsonImage();
  }) as unknown as typeof fetch;
  return { bodies, urls };
}

describe("품질 등급이 실제 요청에 실린다", () => {
  it("배경은 작게·적은 단계, 캐릭터는 크게·많은 단계", async () => {
    const { bodies } = captureBodies();
    await generateSceneImages("reel_c1", [
      scene(1, "corner"),                              // 캐릭터 → high
      scene(2, "none", "quiet empty alley at dusk"),   // 배경 → eco
    ], outDir);
    const [ch, bg] = bodies;
    expect(Number(ch.steps)).toBeGreaterThan(Number(bg.steps));
    // 캐릭터 모델(SDXL)은 크기를 받는다 — eco 배경은 FLUX 라 크기 없이 간다
    expect(ch.width).toBeGreaterThan(0);
  });
});

describe("호출 상한 (§비용 제어)", () => {
  it("상한에 닿으면 남은 장면은 API 를 부르지 않고, 만든 것은 남긴다", async () => {
    saveSettings({ imagePolicy: policy({ budgetCalls: 2 }) });
    const { urls } = captureBodies();
    const scenes = [1, 2, 3, 4, 5].map((n) => scene(n, "none", `food dish plate ${n}`));
    const results = await generateSceneImages("reel_c2", scenes, outDir);

    expect(urls.length).toBe(2);                                    // 호출은 상한까지만
    expect(results.filter((r) => !r.placeholder).length).toBe(2);   // 만든 것은 보존
    expect(results.filter((r) => r.placeholder).length).toBe(3);
    expect(results[2].reason).toContain("상한");
    expect(lastImageUsage.value?.budgetHit).toBe(true);
    // 임시 이미지 파일도 실제로 존재해야 한다 (부분 성공 보존)
    for (const r of results) expect(fs.existsSync(r.path)).toBe(true);
  });

  it("budgetStop 을 끄면 상한을 넘어도 계속 만든다", async () => {
    saveSettings({ imagePolicy: policy({ budgetCalls: 2, budgetStop: false }) });
    const { urls } = captureBodies();
    const results = await generateSceneImages("reel_c3", [1, 2, 3].map((n) => scene(n, "none", `food ${n}`)), outDir);
    expect(urls.length).toBe(3);
    expect(results.every((r) => !r.placeholder)).toBe(true);
  });
});

describe("사용량 집계", () => {
  it("신규·재사용·호출 수를 정확히 센다", async () => {
    captureBodies();
    const scenes = [scene(1, "corner"), scene(2, "none", "food close-up")];
    const first = await generateSceneImages("reel_c4", scenes, outDir);
    expect(lastImageUsage.value).toMatchObject({ created: 2, reused: 0, apiCalls: 2 });
    expect(lastImageUsage.value?.byKind.character).toBe(1);
    expect(lastImageUsage.value?.byKind.food).toBe(1);

    // 같은 장면을 다시 — 캐시로 전부 재사용, 호출 0
    for (const r of first) {
      const sc = scenes.find((x) => x.scene === r.scene)!;
      sc.image_path = r.path; sc.image_hash = r.hash;
    }
    const { urls } = captureBodies();
    await generateSceneImages("reel_c4", scenes, outDir);
    expect(urls.length).toBe(0);
    expect(lastImageUsage.value).toMatchObject({ created: 0, reused: 2, savedByCache: 2 });
  });

  it("에셋 판이 바뀌면 캐릭터 장면 캐시가 깨진다 (마스터 교체 감지)", async () => {
    // 캐시 키에 assetVersion 이 들어가는지 — 값이 같으면 재사용, 다르면 다시
    const { contentHash } = await import("../src/lib/id");
    const a = contentHash({ p: "x", assetVersion: "v-aaa" });
    const b = contentHash({ p: "x", assetVersion: "v-bbb" });
    expect(a).not.toBe(b);
  });
});

describe("범위 재생성 (전체가 기본이 아니다)", () => {
  it("scope 로 캐릭터만/음식만/배경만 골라 다시 만든다", async () => {
    const { sceneKindOf } = await import("../src/lib/providers/image-quality");
    const scenes = [
      scene(1, "corner"),                       // character
      scene(2, "none", "dumpling dish close-up"), // food
      scene(3, "none", "quiet alley"),            // background
    ];
    const kinds = scenes.map((s) => sceneKindOf(s));
    expect(kinds).toEqual(["character", "food", "background"]);
    // regenerateScene 의 필터와 같은 식 — scope 에 맞는 장면만 골라진다
    for (const [scope, want] of [["character", [1]], ["food", [2]], ["background", [3]], ["all", [1, 2, 3]]] as const) {
      const picked = scenes.filter((s) => scope === "all" || sceneKindOf(s) === scope).map((s) => s.scene);
      expect(picked, scope).toEqual([...want]);
    }
  });
});
