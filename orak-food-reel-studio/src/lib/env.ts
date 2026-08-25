import { z } from "zod";

/** .env 검증 — 키가 없어도 프로그램은 뜨고, 해당 기능만 "연결 필요"로 표시 */
export const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().optional().default("claude-opus-5"),
  ELEVENLABS_API_KEY: z.string().optional().default(""),
  ELEVENLABS_VOICE_ID: z.string().optional().default(""),
  ELEVENLABS_MODEL: z.string().optional().default("eleven_multilingual_v2"),
  IMAGE_PROVIDER: z.enum(["gemini", "openai", "cloudflare", "sample"]).optional().default("sample"),
  IMAGE_API_KEY: z.string().optional().default(""),
  IMAGE_MODEL: z.string().optional().default(""),
  // Cloudflare Workers AI (무료 사용량으로 이미지 생성)
  CLOUDFLARE_ACCOUNT_ID: z.string().optional().default(""),
  CLOUDFLARE_API_TOKEN: z.string().optional().default(""),
  CLOUDFLARE_IMAGE_MODEL: z.string().optional().default(""),
  CLOUDFLARE_CHARACTER_MODEL: z.string().optional().default(""),
  INSTAGRAM_ACCESS_TOKEN: z.string().optional().default(""),
  INSTAGRAM_USER_ID: z.string().optional().default(""),
  PUBLIC_MEDIA_BASE_URL: z.string().optional().default(""),
  APP_PORT: z.coerce.number().int().min(1).max(65535).optional().default(3000),
  APP_MODE: z.enum(["sample", "live"]).optional().default("sample"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

/** 테스트용: 캐시 무효화 */
export function resetEnvCache(): void {
  cached = null;
}

export type ServiceKey = "llm" | "image" | "tts" | "instagram";

/**
 * 각 서비스가 실제 API를 쓸 준비가 됐는지.
 * 키는 설정 화면 저장값이 .env 보다 우선하므로 secrets 를 통해 확인한다.
 */
export async function serviceReady(env: Env = getEnv()): Promise<Record<ServiceKey, boolean>> {
  const { resolveSecret } = await import("./secrets");
  const { getSettings } = await import("./settings");
  const { resolveIgAuth } = await import("./providers/instagram");
  const settings = getSettings();
  const provider = settings.imageProvider || env.IMAGE_PROVIDER;
  // Instagram 도 설정 화면 저장값이 .env 보다 우선한다.
  // .env 만 보면 설정 화면에서 다 넣어 두고도 "준비 안 됨"으로 나온다.
  const ig = resolveIgAuth();
  const publicBase = (settings.publicMediaBaseUrl || env.PUBLIC_MEDIA_BASE_URL || "").trim();
  return {
    llm: !!resolveSecret("ANTHROPIC_API_KEY"),
    image: provider !== "sample" && !!resolveSecret("IMAGE_API_KEY"),
    tts: !!resolveSecret("ELEVENLABS_API_KEY"),
    instagram: !!ig.token && !!ig.userId && !!publicBase,
  };
}
