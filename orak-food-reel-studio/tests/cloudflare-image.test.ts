import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("cloudflare");
process.env.APP_MODE = "live";
process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
process.env.CLOUDFLARE_API_TOKEN = "cf-test-token-000000000000000000000000";

import { CloudflareImage, isCloudflareQuota, cloudflareModels } from "../src/lib/providers/cloudflare-image";
import { capabilityOf, looksLikeCfModel, DEFAULT_IMAGE_MODEL, DEFAULT_CHARACTER_MODEL } from "../src/lib/providers/cloudflare-models";
import { friendlyCloudflareError } from "../src/lib/providers/cloudflare-errors";
import { fallbackProviders, isQuotaError } from "../src/lib/providers/image";
import { ApiError } from "../src/lib/providers/http";
import { saveSettings } from "../src/lib/settings";
import { setSecret } from "../src/lib/secrets";

// ffmpeg 가 읽을 수 있는 진짜 1x1 PNG — 세로 규격 변환까지 실제로 태운다
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let realFetch: typeof globalThis.fetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

const jsonReply = (body: unknown, status = 200) => ({
  ok: status < 400, status,
  headers: new Headers({ "content-type": "application/json" }),
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => new ArrayBuffer(0),
}) as unknown as Response;

const binaryReply = (buf: Buffer) => ({
  ok: true, status: 200,
  headers: new Headers({ "content-type": "image/png" }),
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  text: async () => "",
}) as unknown as Response;

describe("모델 성질표", () => {
  it("FLUX 는 참조·negative 를 못 받는다 (프롬프트로만 붙잡아야 한다)", () => {
    const c = capabilityOf(DEFAULT_IMAGE_MODEL);
    expect(c).toEqual({ negativePrompt: false, referenceImage: false, size: false });
  });
  it("SDXL 계열은 참조 이미지와 negative_prompt 를 받는다", () => {
    const c = capabilityOf(DEFAULT_CHARACTER_MODEL);
    expect(c).toEqual({ negativePrompt: true, referenceImage: true, size: true });
  });
  it("모르는 모델은 가장 좁게 잡는다", () => {
    expect(capabilityOf("@cf/unknown/future-model").referenceImage).toBe(false);
  });
  it("모델 이름 모양 검사", () => {
    expect(looksLikeCfModel("@cf/black-forest-labs/flux-1-schnell")).toBe(true);
    expect(looksLikeCfModel("gpt-image-1")).toBe(false);
  });
});

describe("Cloudflare 이미지 생성", () => {
  it("FLUX 응답(JSON base64)을 읽어 9:16 으로 만든다", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return jsonReply({ success: true, result: { image: PNG_1x1 } });
    }) as unknown as typeof fetch;

    const buf = await new CloudflareImage().generate({ prompt: "korean food photo" });
    expect(buf.length).toBeGreaterThan(500); // 1080x1920 JPEG 로 변환된 결과
    expect(calls[0].url).toContain("/ai/run/@cf/black-forest-labs/flux-1-schnell");
    // FLUX 에는 안 받는 값을 보내지 않는다
    expect(calls[0].body.negative_prompt).toBeUndefined();
    expect(calls[0].body.image_b64).toBeUndefined();
  });

  it("SD 계열 응답(이미지 바이트)도 읽는다 — Content-Type 으로 가른다", async () => {
    const png = Buffer.from(PNG_1x1, "base64");
    globalThis.fetch = vi.fn(async () => binaryReply(png)) as unknown as typeof fetch;
    saveSettings({ cloudflare: { accountId: "", imageModel: "@cf/stabilityai/stable-diffusion-xl-base-1.0", characterModel: "" } });
    const buf = await new CloudflareImage().generate({ prompt: "x" });
    expect(buf.length).toBeGreaterThan(500);
    saveSettings({ cloudflare: { accountId: "", imageModel: "", characterModel: "" } });
  });

  it("오락이 장면은 캐릭터 모델 + 참조 + negative_prompt 로 간다", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let firstUrl = "";
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!firstUrl) firstUrl = String(url);
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return jsonReply({ success: true, result: { image: PNG_1x1 } });
    }) as unknown as typeof fetch;

    // 참조 이미지 파일을 하나 만들어 둔다
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const ref = path.join(os.tmpdir(), "oraki-master-test.png");
    fs.writeFileSync(ref, Buffer.from(PNG_1x1, "base64"));

    await new CloudflareImage().generate({ prompt: "oraki eats dumplings", characterScene: true, referenceImagePaths: [ref] });
    expect(firstUrl).toContain(encodeURIComponent === undefined ? "" : "/ai/run/@cf/bytedance/stable-diffusion-xl-lightning");
    expect(calls[0].negative_prompt).toContain("different face");
    expect(calls[0].image_b64).toBe(PNG_1x1);
    expect(String(calls[0].prompt)).toContain("ORAKI MASTER");
  });

  it("캐릭터 모델이 참조를 못 받으면 금지 규칙을 본문에 넣는다", async () => {
    saveSettings({ cloudflare: { accountId: "", imageModel: "", characterModel: "@cf/black-forest-labs/flux-1-schnell" } });
    const calls: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return jsonReply({ success: true, result: { image: PNG_1x1 } });
    }) as unknown as typeof fetch;
    await new CloudflareImage().generate({ prompt: "oraki", characterScene: true });
    expect(calls[0].negative_prompt).toBeUndefined();
    expect(String(calls[0].prompt)).toContain("STRICTLY AVOID");
    saveSettings({ cloudflare: { accountId: "", imageModel: "", characterModel: "" } });
  });

  it("안 받는 값 때문에 400 이 나면 그 값을 빼고 한 번 더 시도한다", async () => {
    saveSettings({ cloudflare: { accountId: "", imageModel: "", characterModel: "@cf/unknown/new-model-with-refs" } });
    // 성질표를 넓게 짐작하도록 모델 이름을 sd 계열로
    saveSettings({ cloudflare: { accountId: "", imageModel: "", characterModel: "@cf/x/stable-diffusion-next" } });
    let n = 0;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      n++;
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      if (n === 1) return jsonReply({ success: false, errors: [{ code: 5006, message: "unknown field negative_prompt" }] }, 200);
      return jsonReply({ success: true, result: { image: PNG_1x1 } });
    }) as unknown as typeof fetch;
    const buf = await new CloudflareImage().generate({ prompt: "oraki", characterScene: true });
    expect(buf.length).toBeGreaterThan(500);
    expect(Object.keys(bodies[1])).toEqual(["prompt"]); // 두 번째는 기본 값만
    saveSettings({ cloudflare: { accountId: "", imageModel: "", characterModel: "" } });
  });

  it("429 는 무료 사용량 소진으로 본다 (재시도 대상 아님)", async () => {
    globalThis.fetch = vi.fn(async () => jsonReply({ errors: [{ message: "rate limited" }] }, 429)) as unknown as typeof fetch;
    let caught: unknown;
    try { await new CloudflareImage().generate({ prompt: "x" }); } catch (e) { caught = e; }
    expect(isCloudflareQuota(caught)).toBe(true);
    expect(isQuotaError(caught)).toBe(true); // 파이프라인의 한도 감지에도 걸린다
    // withRetry 는 4xx 를 재시도하지 않는다 → fetch 는 1번만
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});

describe("오류 안내", () => {
  it("401/403/429 를 구분해 다음 할 일을 알려준다", () => {
    expect(friendlyCloudflareError(new ApiError("cloudflare-image", 401, "401"))).toContain("API Token");
    expect(friendlyCloudflareError(new ApiError("cloudflare-image", 403, "403"))).toContain("Workers AI 권한");
    expect(friendlyCloudflareError(new ApiError("cloudflare-image", 429, "429"))).toContain("무료 사용량");
    expect(friendlyCloudflareError(new ApiError("cloudflare-image", 404, "404"))).toContain("Account ID");
  });
});

describe("대체 순서 (§43)", () => {
  it("Cloudflare → Gemini → OpenAI → Sample, 설정된 것만", () => {
    setSecret("IMAGE_API_KEY", "AIzaTESTKEY000000000000000");
    const names = fallbackProviders("openai").map((p) => p.name);
    // openai 가 실패한 상황: cloudflare(설정됨) → gemini(AIza 키) → sample
    expect(names).toEqual(["cloudflare", "gemini", "sample"]);
    expect(fallbackProviders("cloudflare").map((p) => p.name)).toEqual(["gemini", "sample"]);
    setSecret("IMAGE_API_KEY", "");
  });

  it("아무것도 설정 안 됐으면 Sample 만 남는다", () => {
    const save = { id: process.env.CLOUDFLARE_ACCOUNT_ID, tk: process.env.CLOUDFLARE_API_TOKEN };
    process.env.CLOUDFLARE_ACCOUNT_ID = ""; process.env.CLOUDFLARE_API_TOKEN = "";
    // env 캐시 무효화
    return import("../src/lib/env").then(({ resetEnvCache }) => {
      resetEnvCache();
      expect(fallbackProviders("cloudflare").map((p) => p.name)).toEqual(["sample"]);
      process.env.CLOUDFLARE_ACCOUNT_ID = save.id; process.env.CLOUDFLARE_API_TOKEN = save.tk;
      resetEnvCache();
    });
  });
});

describe("모델 설정 우선순위", () => {
  it("설정 > .env > 기본값", () => {
    expect(cloudflareModels().image).toBe(DEFAULT_IMAGE_MODEL);
    saveSettings({ cloudflare: { accountId: "", imageModel: "@cf/x/custom", characterModel: "" } });
    expect(cloudflareModels().image).toBe("@cf/x/custom");
    expect(cloudflareModels().character).toBe(DEFAULT_CHARACTER_MODEL);
    saveSettings({ cloudflare: { accountId: "", imageModel: "", characterModel: "" } });
  });
});
