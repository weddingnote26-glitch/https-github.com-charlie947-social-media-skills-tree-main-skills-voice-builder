import { handle, ok } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { resolveIgAuth } from "@/lib/providers/instagram";
import { resolveSecret } from "@/lib/secrets";
import { imageKeyMismatch } from "@/lib/providers/image-model";
import { describeKeyFailure } from "@/lib/providers/api-failure";
import { redactError, redact } from "@/lib/redact";

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
            return r.ok
              ? { ok: true, detail: "Claude 연결 성공" }
              : { ok: false, detail: redact(describeKeyFailure("anthropic", r.status, await r.text().catch(() => ""))) };
          }
          case "tts": {
            const elevenKey = resolveSecret("ELEVENLABS_API_KEY");
            if (!elevenKey) return { ok: false, detail: "ElevenLabs API 키가 없습니다. 위 칸에 넣고 저장하세요." };
            const r = await fetch("https://api.elevenlabs.io/v1/voices", {
              headers: { "xi-api-key": elevenKey },
              signal: AbortSignal.timeout(10000),
            });
            if (!r.ok) return { ok: false, detail: redact(describeKeyFailure("elevenlabs", r.status, await r.text().catch(() => ""))) };
            const data = await r.json() as { voices?: Array<{ voice_id: string; name: string }> };
            // 실제로 쓰이는 값은 설정에 저장된 목소리다 (.env 값은 예비)
            const chosen = getSettings().tts.voiceId || env.ELEVENLABS_VOICE_ID;
            const found = data.voices?.find((v) => v.voice_id === chosen);
            const note = found
              ? ` (선택: ${found.name})`
              : chosen
                ? " · 저장된 목소리를 계정에서 찾지 못했습니다. 아래 목록에서 다시 골라 주세요"
                : " · 아직 목소리를 고르지 않았습니다";
            return { ok: true, detail: `연결 성공 · 보이스 ${data.voices?.length ?? 0}개${note}` };
          }
          case "image": {
            if ((getSettings().imageProvider || env.IMAGE_PROVIDER) === "sample") return { ok: true, detail: "Sample Mode — 외부 API를 쓰지 않습니다" };
            const imageKey = resolveSecret("IMAGE_API_KEY");
            if (!imageKey) return { ok: false, detail: "이미지 API 키가 없습니다. 위 칸에 넣고 저장하세요." };
            const imageProvider = getSettings().imageProvider || env.IMAGE_PROVIDER;
            const mismatch = imageKeyMismatch(imageProvider, imageKey);
            if (mismatch) return { ok: false, detail: mismatch };
            if (imageProvider === "gemini") {
              const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(imageKey)}`, { signal: AbortSignal.timeout(10000) });
              return r.ok ? { ok: true, detail: "Gemini 연결 성공" } : { ok: false, detail: redact(describeKeyFailure("gemini", r.status, await r.text().catch(() => ""))) };
            }
            const r = await fetch("https://api.openai.com/v1/models", {
              headers: { authorization: `Bearer ${imageKey}` }, signal: AbortSignal.timeout(10000),
            });
            return r.ok ? { ok: true, detail: "OpenAI 연결 성공" } : { ok: false, detail: redact(describeKeyFailure("openai", r.status, await r.text().catch(() => ""))) };
          }
          case "instagram": {
            const { token, userId } = resolveIgAuth();
            // 저장한 값은 보안상 입력칸에 다시 채워 넣지 않는다 →
            // "칸이 비었는데 왜 400 이 나오지" 를 없애려면 무엇이 없는지 먼저 말해 줘야 한다
            if (!token && !userId) {
              return { ok: false, detail: "Access Token 과 Instagram User ID 를 아직 저장하지 않았습니다. 위 두 칸에 넣고 [암호화 저장]을 누른 뒤 다시 눌러 주세요." };
            }
            if (!token) return { ok: false, detail: "Access Token 이 없습니다. 위 칸에 붙여넣고 [암호화 저장]을 누르세요." };
            if (!userId) return { ok: false, detail: "Instagram User ID 가 없습니다. 위 칸에 넣고 [암호화 저장]을 누르세요." };
            // 아이디(@orak_food)를 넣는 실수 — 보내 봐야 100 오류만 돌아온다
            if (!/^\d+$/.test(userId)) {
              return { ok: false, detail: `Instagram User ID 는 숫자만 들어갑니다. 지금 저장된 값은 "${userId.slice(0, 24)}" 입니다 — 사용자 이름(@orak_food)이 아니라 숫자로 된 계정 ID 를 넣어 주세요.` };
            }
            // 토큰이 잘려 붙여넣어진 경우 — Meta 토큰은 보통 100자가 넘는다
            if (token.length < 30) {
              return { ok: false, detail: `저장된 토큰이 너무 짧습니다 (${token.length}자). 액세스 토큰은 보통 100자가 넘습니다 — 복사할 때 일부만 붙여넣지 않았는지 확인해 주세요.` };
            }
            const r = await fetch(`https://graph.facebook.com/v21.0/${userId}?fields=username&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10000) });
            if (!r.ok) return { ok: false, detail: redact(describeKeyFailure("instagram", r.status, await r.text().catch(() => ""))) };
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
        return { ok: false, detail: redactError(e) };
      }
    };
    return ok(await test());
  });
}
