import { handle, ok } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { resolveIgAuth } from "@/lib/providers/instagram";
import { resolveSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/** §42 각 API [연결 테스트] */
export async function POST(req: Request) {
  return handle(async () => {
    const { service } = await req.json() as { service: string };
    const env = getEnv();
    const test = async (): Promise<{ ok: boolean; detail: string }> => {
      try {
        switch (service) {
          case "llm": {
            const anthropicKey = resolveSecret("ANTHROPIC_API_KEY");
            if (!anthropicKey) return { ok: false, detail: "Claude API 키가 없습니다. 위 칸에 넣고 저장하세요." };
            const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
              headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
              signal: AbortSignal.timeout(10000),
            });
            return r.ok ? { ok: true, detail: "Claude 연결 성공" } : { ok: false, detail: `응답 ${r.status}` };
          }
          case "tts": {
            const elevenKey = resolveSecret("ELEVENLABS_API_KEY");
            if (!elevenKey) return { ok: false, detail: "ElevenLabs API 키가 없습니다. 위 칸에 넣고 저장하세요." };
            const r = await fetch("https://api.elevenlabs.io/v1/voices", {
              headers: { "xi-api-key": elevenKey },
              signal: AbortSignal.timeout(10000),
            });
            if (!r.ok) return { ok: false, detail: `응답 ${r.status}` };
            const data = await r.json() as { voices?: Array<{ voice_id: string; name: string }> };
            const found = data.voices?.find((v) => v.voice_id === env.ELEVENLABS_VOICE_ID);
            return { ok: true, detail: `연결 성공 · 보이스 ${data.voices?.length ?? 0}개${found ? ` (선택: ${found.name})` : env.ELEVENLABS_VOICE_ID ? " · VOICE_ID를 찾지 못했습니다" : ""}` };
          }
          case "image": {
            if ((getSettings().imageProvider || env.IMAGE_PROVIDER) === "sample") return { ok: true, detail: "Sample Mode — 외부 API를 쓰지 않습니다" };
            const imageKey = resolveSecret("IMAGE_API_KEY");
            if (!imageKey) return { ok: false, detail: "이미지 API 키가 없습니다. 위 칸에 넣고 저장하세요." };
            if ((getSettings().imageProvider || env.IMAGE_PROVIDER) === "gemini") {
              const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${imageKey}`, { signal: AbortSignal.timeout(10000) });
              return r.ok ? { ok: true, detail: "Gemini 연결 성공" } : { ok: false, detail: `응답 ${r.status}` };
            }
            const r = await fetch("https://api.openai.com/v1/models", {
              headers: { authorization: `Bearer ${imageKey}` }, signal: AbortSignal.timeout(10000),
            });
            return r.ok ? { ok: true, detail: "OpenAI 연결 성공" } : { ok: false, detail: `응답 ${r.status}` };
          }
          case "instagram": {
            const { token, userId } = resolveIgAuth();
            if (!token || !userId) return { ok: false, detail: "Access Token과 IG User ID를 설정하세요" };
            const r = await fetch(`https://graph.facebook.com/v21.0/${userId}?fields=username&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10000) });
            if (!r.ok) return { ok: false, detail: `응답 ${r.status} — 토큰/권한을 확인하세요` };
            const data = await r.json() as { username?: string };
            return { ok: true, detail: `연결 성공 — @${data.username ?? userId}` };
          }
          case "ffmpeg": {
            const { ffmpegVersion } = await import("@/lib/ffmpeg");
            const v = await ffmpegVersion();
            return v ? { ok: true, detail: v } : { ok: false, detail: "FFmpeg를 찾을 수 없습니다" };
          }
          default:
            return { ok: false, detail: `알 수 없는 서비스: ${service}` };
        }
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    };
    return ok(await test());
  });
}
