import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTempDb } from "./helpers";
useTempDb("image-routing");
process.env.APP_MODE = "live";
process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
process.env.CLOUDFLARE_API_TOKEN = "cf-test-token-000000000000000000000000";

import { generateSceneImages } from "../src/lib/pipeline/images";
import { saveSettings } from "../src/lib/settings";
import type { Scene } from "../src/lib/schema";

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const scene = (n: number, presence: Scene["character_presence"]): Scene => ({
  scene: n, start: n * 3, end: n * 3 + 3,
  narration: `${n}`, subtitle: `${n}`, visual_prompt: `scene ${n} prompt`,
  camera_motion: "static", character_action: null, character_expression: null,
  character_presence: presence, fact_source: "현장",
}) as Scene;

let realFetch: typeof globalThis.fetch;
let outDir: string;
beforeEach(() => {
  realFetch = globalThis.fetch;
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "orak-route-"));
  saveSettings({ imageProvider: "cloudflare", imagePolicy: { fallback: true, reuseCache: true } });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* 임시 */ }
});

const jsonImage = () => ({
  ok: true, status: 200,
  headers: new Headers({ "content-type": "application/json" }),
  text: async () => JSON.stringify({ success: true, result: { image: PNG_1x1 } }),
  arrayBuffer: async () => new ArrayBuffer(0),
}) as unknown as Response;

describe("장면별 모델 라우팅 (§27)", () => {
  it("오락이 장면은 캐릭터 모델, 음식 장면은 FLUX 로 간다", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => { urls.push(String(url)); return jsonImage(); }) as unknown as typeof fetch;

    // corner = 오락이 등장, none = 음식만
    const results = await generateSceneImages("reel_t1", [scene(1, "corner"), scene(2, "none")], outDir);
    expect(results.filter((r) => !r.placeholder).length).toBe(2);
    expect(urls[0]).toContain("stable-diffusion-xl-lightning"); // 캐릭터
    expect(urls[1]).toContain("flux-1-schnell");                 // 음식
  });

  it("이미지마다 어떻게 만들었는지 metadata 를 남긴다", async () => {
    globalThis.fetch = vi.fn(async () => jsonImage()) as unknown as typeof fetch;
    await generateSceneImages("reel_t2", [scene(1, "none")], outDir);
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, "scene-01.json"), "utf8"));
    expect(meta.provider).toBe("cloudflare");
    expect(meta.scene_type).toBe("food");
    expect(meta.prompt).toBe("scene 1 prompt");
    expect(meta.created_at).toBeTruthy();
  });

  it("Cloudflare 429 → 재시도 없이 대체 공급자(Sample)로 넘어가고, 남은 장면도 다시 부르지 않는다", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return {
        ok: false, status: 429,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ errors: [{ message: "quota" }] }),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const results = await generateSceneImages("reel_t3", [scene(1, "none"), scene(2, "none"), scene(3, "none")], outDir);
    // 세 장면 모두 채워지되(제작이 멈추지 않는다) 전부 임시 이미지
    expect(results.length).toBe(3);
    expect(results.every((r) => r.placeholder)).toBe(true);
    // Cloudflare 는 첫 장면에서 딱 1번만 불렸어야 한다 (429 무한 재시도 금지)
    expect(calls).toBe(1);
  });

  it("대체 끄면(fallback=false) 다른 공급자를 부르지 않는다", async () => {
    saveSettings({ imagePolicy: { fallback: false, reuseCache: true } });
    globalThis.fetch = vi.fn(async () => { throw new Error("500 down"); }) as unknown as typeof fetch;
    const results = await generateSceneImages("reel_t4", [scene(1, "none")], outDir);
    expect(results[0].placeholder).toBe(true); // 임시 이미지로 채워지긴 한다
  });

  it("기존 이미지 재사용을 끄면 캐시가 맞아도 다시 만든다", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => { calls++; return jsonImage(); }) as unknown as typeof fetch;

    const first = await generateSceneImages("reel_t5", [scene(1, "none")], outDir);
    const withCache = [{ ...scene(1, "none"), image_hash: first[0].hash, image_path: first[0].path }] as Scene[];

    await generateSceneImages("reel_t5", withCache, outDir);
    expect(calls).toBe(1); // 재사용 켬 → 두 번째는 안 부른다

    saveSettings({ imagePolicy: { fallback: true, reuseCache: false } });
    await generateSceneImages("reel_t5", withCache, outDir);
    expect(calls).toBe(2); // 재사용 끔 → 다시 만든다
  });
});
