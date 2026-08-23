import { handle, ok } from "@/lib/api";
import { listElevenLabsVoices } from "@/lib/providers/tts";
import { getEnv } from "@/lib/env";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** §16 계정에 등록된 ElevenLabs 목소리 목록 — 설정 화면에서 골라 쓰기 */
export async function GET() {
  return handle(async () => {
    const env = getEnv();
    if (!env.ELEVENLABS_API_KEY) {
      return ok({ ready: false, voices: [], selected: getSettings().tts.voiceId, notice: "ELEVENLABS_API_KEY가 아직 없습니다. .env에 키를 넣고 프로그램을 다시 시작하세요." });
    }
    const voices = await listElevenLabsVoices();
    return ok({ ready: true, voices, selected: getSettings().tts.voiceId || env.ELEVENLABS_VOICE_ID });
  });
}
