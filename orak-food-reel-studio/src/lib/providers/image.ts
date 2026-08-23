import path from "node:path";
import fs from "node:fs";
import { getEnv } from "../env";
import { getSettings } from "../settings";
import { ApiError, fetchJson, withRetry } from "./http";
import type { ImageProvider } from "./types";
import { runFFmpeg } from "../ffmpeg";
import { DIRS } from "../paths";

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

/** Gemini — 기준 이미지가 있으면 이미지 입력을 지원하는 모델로, 없으면 Imagen으로 */
class GeminiImage implements ImageProvider {
  readonly name = "gemini";
  async generate(req: { prompt: string; referenceImagePaths?: string[] }): Promise<Buffer> {
    const env = getEnv();
    const configured = getSettings().imageModel || env.IMAGE_MODEL;
    const refs = readRefs(req.referenceImagePaths);

    // 기준 이미지가 있으면 이미지 입력이 가능한 모델을 사용 (Imagen predict는 참조 입력 불가)
    if (refs.length > 0) {
      const model = configured && !configured.includes("imagen") ? configured : "gemini-2.5-flash-image";
      return withRetry("gemini-image", "generate-with-reference", async () => {
        const out = await fetchJson<{
          candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }> } }>;
        }>(
          "gemini-image",
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.IMAGE_API_KEY}`,
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
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${env.IMAGE_API_KEY}`,
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
    const model = getSettings().imageModel || env.IMAGE_MODEL || "gpt-image-1";
    const refs = readRefs(req.referenceImagePaths);
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
          headers: { authorization: `Bearer ${env.IMAGE_API_KEY}` },
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
            authorization: `Bearer ${env.IMAGE_API_KEY}`,
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

export function getImageProvider(): ImageProvider {
  const env = getEnv();
  const provider = getSettings().imageProvider || env.IMAGE_PROVIDER;
  if (env.APP_MODE === "sample" || provider === "sample" || !env.IMAGE_API_KEY) return new SampleImage();
  if (provider === "gemini") return new GeminiImage();
  return new OpenAIImage();
}
