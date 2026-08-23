import { fail } from "@/lib/api";
import { createElevenLabsTTS } from "@/lib/providers/tts";
import { getSettings } from "@/lib/settings";
import { resolveSecret } from "@/lib/secrets";
import { logError } from "@/lib/log";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** 고른 목소리로 한국어 한 문장을 실제 생성해서 들려줍니다 (크레딧이 소모됨) */
const SAMPLE_TEXT = "신림에 이런 집이 있습니다. 직접 확인해보겠습니다.";

export async function POST(req: Request) {
  try {
    if (!resolveSecret("ELEVENLABS_API_KEY")) return fail("ElevenLabs API 키가 없습니다");
    const body = z.object({
      voiceId: z.string().min(1),
      text: z.string().max(120).optional(),
    }).safeParse(await req.json());
    if (!body.success) return fail("voiceId가 필요합니다");

    const s = getSettings().tts;
    const buf = await createElevenLabsTTS().synthesize({
      text: body.data.text?.trim() || SAMPLE_TEXT,
      voiceId: body.data.voiceId,
      model: s.model,
      speed: s.speed,
      stability: s.stability,
      similarity: s.similarity,
    });
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("voices-preview", msg);
    return fail(msg, 500);
  }
}
