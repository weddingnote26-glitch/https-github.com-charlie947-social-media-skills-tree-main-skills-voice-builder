import { handle, ok } from "@/lib/api";
import { listElevenLabsModels } from "@/lib/providers/tts";
import { resolveSecret } from "@/lib/secrets";
import { getSettings } from "@/lib/settings";
import { describeKeyFailure } from "@/lib/providers/api-failure";
import { ApiError } from "@/lib/providers/http";
import { redact } from "@/lib/redact";

export const dynamic = "force-dynamic";

/** 계정에서 쓸 수 있는 음성 모델 목록 — 외부 영상 화면에서 골라 쓰기 */
export async function GET() {
  return handle(async () => {
    const selected = getSettings().tts.model;
    if (!resolveSecret("ELEVENLABS_API_KEY")) {
      return ok({
        ready: false, models: [], selected,
        notice: "ElevenLabs API 키가 없어 모델 목록을 불러올 수 없습니다. 아래 칸의 값(설정 화면의 Model)을 그대로 씁니다.",
      });
    }
    try {
      return ok({ ready: true, models: await listElevenLabsModels(), selected });
    } catch (e) {
      // 목록을 못 불러와도 막다른 길이 되면 안 된다 — 설정값을 직접 쓰게 남겨 둔다
      const status = e instanceof ApiError ? e.status : 0;
      const notice = status
        ? describeKeyFailure("elevenlabs", status, e instanceof Error ? e.message : "")
        : redact(e instanceof Error ? e.message : String(e));
      return ok({ ready: false, models: [], selected, notice });
    }
  });
}
