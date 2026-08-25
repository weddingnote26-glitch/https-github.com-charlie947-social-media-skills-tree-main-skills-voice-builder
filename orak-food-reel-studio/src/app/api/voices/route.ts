import { handle, ok } from "@/lib/api";
import { listElevenLabsVoices } from "@/lib/providers/tts";
import { resolveSecret } from "@/lib/secrets";
import { getSettings } from "@/lib/settings";
import { describeKeyFailure } from "@/lib/providers/api-failure";
import { ApiError } from "@/lib/providers/http";
import { redact } from "@/lib/redact";

export const dynamic = "force-dynamic";

/** §16 계정에 등록된 ElevenLabs 목소리 목록 — 설정 화면에서 골라 쓰기 */
export async function GET() {
  return handle(async () => {
    const selected = getSettings().tts.voiceId;
    if (!resolveSecret("ELEVENLABS_API_KEY")) {
      return ok({ ready: false, voices: [], selected, notice: "ElevenLabs API 키가 아직 없습니다. 위 칸에 키를 넣고 저장하세요." });
    }
    try {
      return ok({ ready: true, voices: await listElevenLabsVoices(), selected });
    } catch (e) {
      // 목록을 못 불러왔다고 막다른 길이 되면 안 된다.
      // 권한이 voices_read 만 없는 경우 음성 생성 자체는 되므로,
      // 무엇이 문제인지 알려주고 ID 직접 입력으로 계속할 수 있게 남겨 둔다.
      const status = e instanceof ApiError ? e.status : 0;
      const notice = status
        ? describeKeyFailure("elevenlabs", status, e instanceof Error ? e.message : "")
        : redact(e instanceof Error ? e.message : String(e));
      return ok({ ready: false, voices: [], selected, notice });
    }
  });
}
