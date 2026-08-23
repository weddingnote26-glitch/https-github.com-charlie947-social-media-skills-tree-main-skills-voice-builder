import { handle, ok } from "@/lib/api";
import { listElevenLabsVoices } from "@/lib/providers/tts";
import { resolveSecret } from "@/lib/secrets";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** §16 계정에 등록된 ElevenLabs 목소리 목록 — 설정 화면에서 골라 쓰기 */
export async function GET() {
  return handle(async () => {
    if (!resolveSecret("ELEVENLABS_API_KEY")) {
      return ok({ ready: false, voices: [], selected: getSettings().tts.voiceId, notice: "ElevenLabs API 키가 아직 없습니다. 아래 칸에 키를 넣고 저장하세요." });
    }
    const voices = await listElevenLabsVoices();
    return ok({ ready: true, voices, selected: getSettings().tts.voiceId });
  });
}
