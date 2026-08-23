import { z } from "zod";

/** .env 검증 — 키가 없어도 프로그램은 뜨고, 해당 기능만 "연결 필요"로 표시 */
export const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().optional().default("claude-sonnet-5"),
  ELEVENLABS_API_KEY: z.string().optional().default(""),
  ELEVENLABS_VOICE_ID: z.string().optional().default(""),
  ELEVENLABS_MODEL: z.string().optional().default("eleven_multilingual_v2"),
  IMAGE_PROVIDER: z.enum(["gemini", "openai", "sample"]).optional().default("sample"),
  IMAGE_API_KEY: z.string().optional().default(""),
  IMAGE_MODEL: z.string().optional().default(""),
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

/** 각 서비스가 실제 API를 쓸 준비가 됐는지 */
export function serviceReady(env: Env = getEnv()): Record<ServiceKey, boolean> {
  return {
    llm: !!env.ANTHROPIC_API_KEY,
    image: env.IMAGE_PROVIDER !== "sample" && !!env.IMAGE_API_KEY,
    tts: !!env.ELEVENLABS_API_KEY && !!env.ELEVENLABS_VOICE_ID,
    instagram: !!env.INSTAGRAM_ACCESS_TOKEN && !!env.INSTAGRAM_USER_ID && !!env.PUBLIC_MEDIA_BASE_URL,
  };
}
