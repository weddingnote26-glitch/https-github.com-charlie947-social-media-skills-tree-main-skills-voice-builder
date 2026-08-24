import path from "node:path";
import fs from "node:fs";
import { getEnv } from "../env";
import { resolveSecret, isSampleMode } from "../secrets";
import { getSettings } from "../settings";
import { ApiError, fetchJson, withRetry } from "./http";
import type { ImageProvider } from "./types";
import { runFFmpeg } from "../ffmpeg";
import { logWarn } from "../log";
import { pickImageModel } from "./image-model";
import { DIRS } from "../paths";
import { CloudflareImage, resolveCloudflareAuth, isCloudflareQuota } from "./cloudflare-image";
import { friendlyCloudflareError } from "./cloudflare-errors";

export { pickImageModel, modelOwner, clearStaleImageModel } from "./image-model";

/** 기준 이미지 파일 → base64 (§14 Master Reference 기반 생성) */
function readRefs(paths: string[] | undefined): Array<{ mime: string; b64: string; path: string }> {
  return (paths ?? [])
    .filter((p) => fs.existsSync(p))
    .map((p) => ({
      path: p,
      mime: p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
      b64: fs.readFileSync(p).toString("base64"),
    }));
}

/** gpt-image-1 은 일부 계정에서 조직 인증(Verify Organization)을 요구한다 */
export function needsOrgVerification(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\b(400|403)\b/.test(msg) && /verif/i.test(msg);
}

/** Gemini — 기준 이미지가 있으면 이미지 입력을 지원하는 모델로, 없으면 Imagen으로 */
class GeminiImage implements ImageProvider {
  readonly name = "gemini";
  async generate(req: { prompt: string; referenceImagePaths?: string[] }): Promise<Buffer> {
    const env = getEnv();
    const configured = pickImageModel("gemini", getSettings().imageModel || env.IMAGE_MODEL, "");
    const refs = readRefs(req.referenceImagePaths);

    // 기준 이미지가 있으면 이미지 입력이 가능한 모델을 사용 (Imagen predict는 참조 입력 불가)
    if (refs.length > 0) {
      const model = configured && !configured.includes("imagen") ? configured : "gemini-2.5-flash-image";
      return withRetry("gemini-image", "generate-with-reference", async () => {
        const out = await fetchJson<{
          candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }> } }>;
        }>(
          "gemini-image",
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(resolveSecret("IMAGE_API_KEY"))}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [
                  ...refs.map((r) => ({ inline_data: { mime_type: r.mime, data: r.b64 } })),
                  { text: `${req.prompt}\n\nThe attached images are the character master reference. Keep the character's identity, face, eye shape, hat, proportions and colors exactly the same as the reference. Output a vertical 9:16 image.` },
                ],
              }],
              generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
            }),
          },
          180_000,
        );
        const parts = out.candidates?.[0]?.content?.parts ?? [];
        const b64 = parts.map((p) => p.inlineData?.data ?? p.inline_data?.data).find(Boolean);
        if (!b64) throw new Error("이미지 응답이 비어 있습니다");
        return Buffer.from(b64, "base64");
      });
    }

    const model = configured || "imagen-3.0-generate-002";
    return withRetry("gemini-image", "generate", async () => {
      const out = await fetchJson<{ predictions?: Array<{ bytesBase64Encoded?: string }> }>(
        "gemini-image",
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${encodeURIComponent(resolveSecret("IMAGE_API_KEY"))}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt: req.prompt }],
            parameters: { sampleCount: 1, aspectRatio: "9:16", personGeneration: "allow_adult" },
          }),
        },
        180_000,
      );
      const b64 = out.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) throw new Error("이미지 응답이 비어 있습니다");
      return Buffer.from(b64, "base64");
    });
  }
}

/** OpenAI — 기준 이미지가 있으면 images/edits(참조 입력), 없으면 generations */
class OpenAIImage implements ImageProvider {
  readonly name = "openai";

  async generate(req: { prompt: string; referenceImagePaths?: string[] }): Promise<Buffer> {
    const env = getEnv();
    const model = pickImageModel("openai", getSettings().imageModel || env.IMAGE_MODEL, "gpt-image-1");
    const refs = readRefs(req.referenceImagePaths);
    try {
      return await this.call(model, req, refs);
    } catch (e) {
      // gpt-image-1 은 계정에 따라 "Verify Organization"을 요구한다.
      // 인증 없이 쓸 수 있는 dall-e-3 로 자동 전환해, 제작이 여기서 멈추지 않게 한다.
      if (model !== "dall-e-3" && needsOrgVerification(e)) {
        logWarn("openai-image", `${model} 은 조직 인증이 필요합니다 — dall-e-3 으로 대신 생성합니다`);
        return await this.call("dall-e-3", req, []);
      }
      throw e;
    }
  }

  private async call(
    model: string,
    req: { prompt: string },
    refs: Array<{ mime: string; b64: string; path: string }>,
  ): Promise<Buffer> {
    const size = model.startsWith("dall-e") ? "1024x1792" : "1024x1536";

    // dall-e 계열은 참조 이미지 편집 방식이 다르므로 기본 생성만 사용
    if (refs.length > 0 && !model.startsWith("dall-e")) {
      return withRetry("openai-image", "generate-with-reference", async () => {
        const form = new FormData();
        form.append("model", model);
        form.append("size", size);
        form.append("n", "1");
        form.append(
          "prompt",
          `${req.prompt}\n\nThe attached images are the character master reference. Keep the character's identity, face, eye shape, hat, proportions and colors exactly the same as the reference.`,
        );
        for (const r of refs) {
          form.append("image[]", new Blob([new Uint8Array(fs.readFileSync(r.path))], { type: r.mime }), path.basename(r.path));
        }
        const res = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { authorization: `Bearer ${resolveSecret("IMAGE_API_KEY")}` },
          body: form,
          signal: AbortSignal.timeout(180_000),
        });
        const text = await res.text();
        if (!res.ok) throw new ApiError("openai-image", res.status, `${res.status} ${text.slice(0, 300)}`);
        const b64 = (JSON.parse(text) as { data?: Array<{ b64_json?: string }> }).data?.[0]?.b64_json;
        if (!b64) throw new Error("이미지 응답이 비어 있습니다");
        return Buffer.from(b64, "base64");
      });
    }

    return withRetry("openai-image", "generate", async () => {
      const out = await fetchJson<{ data?: Array<{ b64_json?: string }> }>(
        "openai-image",
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${resolveSecret("IMAGE_API_KEY")}`,
          },
          body: JSON.stringify({
            model,
            prompt: req.prompt,
            size,
            n: 1,
            ...(model.startsWith("dall-e") ? { response_format: "b64_json" } : {}),
          }),
        },
        180_000,
      );
      const b64 = out.data?.[0]?.b64_json;
      if (!b64) throw new Error("이미지 응답이 비어 있습니다");
      return Buffer.from(b64, "base64");
    });
  }
}

/** Sample Mode — ffmpeg로 장면별 그라데이션 플레이트 생성(외부 API 불필요, §50) */
class SampleImage implements ImageProvider {
  readonly name = "sample";
  async generate(req: { prompt: string; sceneKey?: string }): Promise<Buffer> {
    // 프롬프트 해시로 색을 정해 장면마다 다른 그림이 나오게 함
    let h = 0;
    for (const ch of (req.sceneKey ?? "") + req.prompt) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const hue1 = h % 360;
    const hue2 = (hue1 + 40) % 360;
    const c0 = hsl(hue1, 45, 38);
    const c1 = hsl(hue2, 55, 22);
    const tmp = path.join(DIRS.images, `sample-${h.toString(16)}.jpg`);
    fs.mkdirSync(DIRS.images, { recursive: true });
    await runFFmpeg([
      "-f", "lavfi",
      "-i", `gradients=s=1080x1920:c0=${c0}:c1=${c1}:x0=540:y0=0:x1=540:y1=1920:n=2`,
      "-frames:v", "1",
      "-vf", "vignette=PI/5",
      "-q:v", "4", "-y", tmp,
    ]);
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    return buf;
  }
}

function hsl(h: number, s: number, l: number): string {
  // ffmpeg는 hex만 받으므로 HSL→RGB 변환
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `0x${f(0)}${f(8)}${f(4)}`;
}

/** 실패한 장면을 임시로 채우는 이미지(외부 API 불필요) */
export function getPlaceholderImageProvider(): ImageProvider {
  return new SampleImage();
}

/** 할당량 초과처럼 "더 시도해도 소용없는" 오류인지 */
export function isQuotaError(e: unknown): boolean {
  // Cloudflare 는 429 가 곧 "오늘 무료 사용량 끝" 이다 — 문구를 볼 필요가 없다
  if (isCloudflareQuota(e)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /429/.test(msg) && /quota|billing|exceeded|한도/i.test(msg);
}

export function friendlyImageError(e: unknown): string {
  if (e instanceof ApiError && e.service === "cloudflare-image") return friendlyCloudflareError(e);
  const msg = e instanceof Error ? e.message : String(e);
  if (isQuotaError(msg ? new Error(msg) : e)) {
    // 어디서 무엇을 확인해야 하는지까지 알려준다 — "한도 초과"만으로는 다음 행동이 안 보인다
    const provider = getSettings().imageProvider || getEnv().IMAGE_PROVIDER;
    if (provider === "openai") {
      return "OpenAI 이미지 사용 한도를 초과했습니다. platform.openai.com → Billing 에서 결제 수단과 남은 크레딧을 확인하세요. (충전해도 몇 분 뒤 반영될 수 있습니다)";
    }
    if (provider === "gemini") {
      return "Gemini 이미지 사용 한도를 초과했습니다. aistudio.google.com → Billing 에서 해당 프로젝트를 유료 등급으로 전환하세요.";
    }
    if (provider === "cloudflare") {
      return "Cloudflare 무료 사용량을 오늘치 다 썼습니다. 내일 다시 채워집니다 — 대체 공급자가 켜져 있으면 자동으로 넘어갑니다.";
    }
    return "이미지 API 사용 한도를 초과했습니다. 결제 설정을 확인하거나 잠시 후 다시 시도하세요.";
  }
  if (needsOrgVerification(e)) {
    return "OpenAI 조직 인증이 필요한 모델입니다. 설정에서 모델을 dall-e-3 으로 바꾸거나 platform.openai.com 에서 조직 인증을 완료하세요.";
  }
  if (/401|403|API key|api_key/i.test(msg)) return "이미지 API 키가 올바르지 않습니다. 설정에서 확인하세요.";
  if (/응답이 .*오지 않았습니다/.test(msg)) return msg;
  return msg.slice(0, 200);
}

export function getImageProvider(): ImageProvider {
  const env = getEnv();
  const provider = getSettings().imageProvider || env.IMAGE_PROVIDER;
  if (isSampleMode() || provider === "sample") return new SampleImage();
  // Cloudflare 는 IMAGE_API_KEY 가 아니라 계정 ID + 토큰을 쓴다
  if (provider === "cloudflare") {
    const auth = resolveCloudflareAuth();
    return auth.accountId && auth.token ? new CloudflareImage() : new SampleImage();
  }
  if (!resolveSecret("IMAGE_API_KEY")) return new SampleImage();
  if (provider === "gemini") return new GeminiImage();
  return new OpenAIImage();
}

/**
 * §43 대체 순서 — 지금 고른 공급자가 실패했을 때 시도할 다음 공급자들.
 * 설정이 되어 있는 것만 순서대로 (Cloudflare → Gemini → OpenAI → Sample).
 */
export function fallbackProviders(current: string): ImageProvider[] {
  const out: ImageProvider[] = [];
  const cf = resolveCloudflareAuth();
  const key = resolveSecret("IMAGE_API_KEY");
  if (current !== "cloudflare" && cf.accountId && cf.token) out.push(new CloudflareImage());
  if (current !== "gemini" && key.startsWith("AIza")) out.push(new GeminiImage());
  if (current !== "openai" && key.startsWith("sk-")) out.push(new OpenAIImage());
  out.push(new SampleImage());
  return out;
}
