import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getEnv } from "../env";
import { getSettings } from "../settings";
import { resolveSecret } from "../secrets";
import { ApiError } from "./http";
import { apiLog } from "../db";
import { runFFmpeg } from "../ffmpeg";
import { logInfo, logWarn } from "../log";
import { ORAKI_IDENTITY_LOCK, ORAKI_NEGATIVE_PROMPT, negativeAsRules } from "../character/identity";
import { KOREAN_SCENE_NEGATIVE } from "../content/scene-prompt";
import {
  DEFAULT_IMAGE_MODEL, DEFAULT_CHARACTER_MODEL, capabilityOf,
} from "./cloudflare-models";
import type { ImageProvider } from "./types";

const API = "https://api.cloudflare.com/client/v4";

export interface CfAuth { accountId: string; token: string }

/** 설정 화면 값 우선, 없으면 .env — 다른 공급자와 같은 규칙 */
export function resolveCloudflareAuth(): CfAuth {
  const env = getEnv();
  const cf = getSettings().cloudflare;
  return {
    accountId: (cf.accountId || env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
    token: (resolveSecret("CLOUDFLARE_API_TOKEN") || "").trim(),
  };
}

export function cloudflareModels(): { image: string; character: string } {
  const env = getEnv();
  const cf = getSettings().cloudflare;
  return {
    image: (cf.imageModel || env.CLOUDFLARE_IMAGE_MODEL || DEFAULT_IMAGE_MODEL).trim(),
    character: (cf.characterModel || env.CLOUDFLARE_CHARACTER_MODEL || DEFAULT_CHARACTER_MODEL).trim(),
  };
}

/** 429 = 무료 사용량 소진. 같은 요청을 다시 보내도 소용없다 */
export function isCloudflareQuota(e: unknown): boolean {
  return e instanceof ApiError && e.service === "cloudflare-image" && e.status === 429;
}

/**
 * Workers AI 호출.
 *
 * 모델마다 돌려주는 모양이 다르다(JSON base64 / 이미지 바이트).
 * 모델 이름으로 짐작하지 않고 Content-Type 을 보고 갈라 읽는다.
 */
async function runModel(auth: CfAuth, model: string, body: Record<string, unknown>): Promise<Buffer> {
  const url = `${API}/accounts/${encodeURIComponent(auth.accountId)}/ai/run/${model}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApiError("cloudflare-image", 408, "응답이 3분 안에 오지 않았습니다. 인터넷 연결을 확인해 주세요.");
    }
    throw e;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError("cloudflare-image", res.status, `${res.status} ${text.slice(0, 300)}`);
  }

  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const raw = await res.text();
    const j = JSON.parse(raw) as {
      success?: boolean;
      result?: { image?: string; images?: string[] };
      errors?: Array<{ code?: number; message?: string }>;
    };
    if (j.success === false) {
      const first = j.errors?.[0];
      throw new ApiError("cloudflare-image", 400, `${first?.code ?? ""} ${first?.message ?? raw.slice(0, 200)}`.trim());
    }
    const b64 = j.result?.image ?? j.result?.images?.[0];
    if (!b64) throw new ApiError("cloudflare-image", 502, "이미지 응답이 비어 있습니다");
    return Buffer.from(b64, "base64");
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 만들어진 이미지를 릴스 규격(1080x1920)으로 맞춘다.
 *
 * FLUX 는 가로·세로를 지정할 수 없어 정사각으로 나온다. 늘려서 찌그러뜨리는 대신
 * 짧은 쪽을 채우고 좌우를 가운데 기준으로 잘라낸다 — 가운데 있는 음식·얼굴이 남는다.
 */
export async function toVertical(buf: Buffer): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orak-cf-"));
  const src = path.join(dir, "in.png");
  const out = path.join(dir, "out.jpg");
  try {
    fs.writeFileSync(src, buf);
    await runFFmpeg([
      "-i", src,
      "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
      "-frames:v", "1", "-q:v", "3", "-y", out,
    ]);
    return fs.readFileSync(out);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 임시 폴더 */ }
  }
}

/** 참조 이미지 한 장 → base64 (여러 장이면 첫 장만: Workers AI 는 한 장만 받는다) */
function firstReference(paths: string[] | undefined): string | null {
  for (const p of paths ?? []) {
    if (fs.existsSync(p)) return fs.readFileSync(p).toString("base64");
  }
  return null;
}

export class CloudflareImage implements ImageProvider {
  readonly name = "cloudflare";

  async generate(req: {
    prompt: string; seed?: number; referenceImagePaths?: string[]; characterScene?: boolean;
    tier?: { steps: number; width: number; height: number };
  }): Promise<Buffer> {
    const auth = resolveCloudflareAuth();
    if (!auth.accountId || !auth.token) {
      throw new ApiError("cloudflare-image", 401, "Cloudflare Account ID 와 API Token 을 설정에서 넣어 주세요.");
    }
    const models = cloudflareModels();
    // 오락이가 나오는 장면만 캐릭터 모델로 — 나머지는 무료 사용량을 적게 먹는 모델로
    const model = req.characterScene ? models.character : models.image;
    const cap = capabilityOf(model);
    const ref = req.characterScene ? firstReference(req.referenceImagePaths) : null;

    // 참조를 못 받는 모델이면 프롬프트로라도 생김새를 못 박는다
    const identity = req.characterScene
      ? (ref && cap.referenceImage ? ORAKI_IDENTITY_LOCK : `${ORAKI_IDENTITY_LOCK}\n\n${negativeAsRules(ORAKI_NEGATIVE_PROMPT)}`)
      : "";
    const prompt = [req.prompt, identity].filter(Boolean).join("\n\n");

    const body: Record<string, unknown> = { prompt };
    /* 외국어·깨진 글자 금지는 캐릭터 장면이든 아니든 언제나 넣는다 —
       간판에 영어·일본어가 찍히는 문제는 배경 장면에서 더 자주 났다. */
    if (cap.negativePrompt) {
      body.negative_prompt = req.characterScene
        ? `${ORAKI_NEGATIVE_PROMPT}, ${KOREAN_SCENE_NEGATIVE}`
        : KOREAN_SCENE_NEGATIVE;
    }
    // 등급별 설정 — 배경·음식은 작게·적은 단계로 만들어 무료 사용량을 아낀다.
    // 최종 1080×1920 은 합성 단계에서 다시 잡히므로 원본이 작아도 영상은 정상이다.
    const tier = req.tier;
    if (tier) {
      body.steps = tier.steps;
      body.num_steps = tier.steps; // 모델마다 이름이 다르다 — 안 받는 쪽은 400 처리에서 빠진다
      if (cap.size) { body.width = tier.width; body.height = tier.height; }
    } else if (cap.size) {
      body.width = 768; body.height = 1344; // 9:16 에 가까운 허용 크기
    }
    if (ref && cap.referenceImage) { body.image_b64 = ref; body.strength = 0.55; }
    if (typeof req.seed === "number") body.seed = req.seed;

    const started = Date.now();
    const action = req.characterScene ? "character" : "image";
    /**
     * 재시도 규칙을 직접 쥔다. 공용 withRetry 는 429 를 "잠시 뒤 다시" 로 보고
     * 재시도하는데, Cloudflare 의 429 는 "오늘 무료 사용량 끝" 이라 몇 번을
     * 다시 보내도 무료 사용량만 축낸다 — 429 는 한 번에 포기한다(§무료 사용량 보호).
     * 다시 시도할 가치가 있는 건 서버 오류(5xx)와 시간 초과(408)뿐이다.
     */
    let raw: Buffer | null = null;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2 && !raw; attempt++) {
      try {
        try {
          raw = await runModel(auth, model, body);
        } catch (e) {
          // 짐작한 성질이 틀렸을 수 있다 — 안 받는 값 때문에 거절당한 거라면 빼고 한 번 더
          if (e instanceof ApiError && e.status === 400 && hasExtras(body)) {
            logWarn("cloudflare-image", `${model} 이 일부 값을 받지 않아 기본 값만으로 다시 시도합니다`);
            raw = await runModel(auth, model, { prompt });
          } else throw e;
        }
        apiLog("cloudflare-image", action, true);
      } catch (e) {
        lastErr = e;
        const status = e instanceof ApiError ? e.status : 0;
        apiLog("cloudflare-image", action, false, status, e instanceof Error ? e.message : String(e));
        const retryable = status >= 500 || status === 408;
        if (!retryable || attempt === 1) throw e;
        logWarn("cloudflare-image", `${action} 실패(${status}) — 한 번 더 시도합니다`);
      }
    }
    if (!raw) throw lastErr;

    logInfo("cloudflare-image", "이미지 생성", {
      model, character: !!req.characterScene, ms: Date.now() - started, bytes: raw.length,
    });
    return await toVertical(raw);
  }
}

function hasExtras(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((k) => k !== "prompt");
}

/** 계정에서 실제로 쓸 수 있는 이미지 모델 목록 (짐작 대신 계정에 물어본다) */
export async function listCloudflareImageModels(auth: CfAuth): Promise<string[]> {
  const url = `${API}/accounts/${encodeURIComponent(auth.accountId)}/ai/models/search?task=Text-to-Image&per_page=100`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${auth.token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new ApiError("cloudflare-image", res.status, `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const j = await res.json() as { result?: Array<{ name?: string }> };
  return (j.result ?? []).map((m) => m.name ?? "").filter(Boolean).sort();
}
