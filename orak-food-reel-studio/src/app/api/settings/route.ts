import { handle, ok, fail } from "@/lib/api";
import { getSettings, saveSettings, kvSet } from "@/lib/settings";
import { encrypt } from "@/lib/crypto";
import { serviceReady } from "@/lib/env";
import { setSecret, secretStatus, getAppMode, type SecretName } from "@/lib/secrets";
import { clearStaleImageModel } from "@/lib/providers/image-model";
import { cleanPastedSecret } from "@/lib/secrets-input";
import { checkVoiceId, checkTtsModel, detectSwappedVoiceFields } from "@/lib/providers/voice-id";
import { igAuthStatus } from "@/lib/providers/instagram";
import { checkPublicMediaUrl } from "@/lib/media-url";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => ok({
    settings: getSettings(),
    services: await serviceReady(),
    mode: getAppMode(),
    // 키 자체는 절대 돌려주지 않는다 — 설정됐는지와 앞뒤 몇 글자만
    secrets: {
      ANTHROPIC_API_KEY: secretStatus("ANTHROPIC_API_KEY"),
      ELEVENLABS_API_KEY: secretStatus("ELEVENLABS_API_KEY"),
      IMAGE_API_KEY: secretStatus("IMAGE_API_KEY"),
      CLOUDFLARE_API_TOKEN: secretStatus("CLOUDFLARE_API_TOKEN"),
      KLING_API_KEY: secretStatus("KLING_API_KEY"),
    },
    // Instagram 토큰도 마찬가지 — 저장 여부와 앞뒤 몇 글자만 (계정 ID 는 비밀이 아니다)
    instagram: igAuthStatus(),
  }));
}

export async function PUT(req: Request) {
  return handle(async () => {
    const body = await req.json() as Record<string, unknown>;
    // Instagram 토큰은 암호화 저장 (§31)
    if (typeof body.igAccessToken === "string") {
      // 빈 값으로 저장하면 지우기 (.env 값이 있으면 그쪽으로 되돌아간다)
      const v = cleanPastedSecret(body.igAccessToken);
      kvSet("ig_token_encrypted", v ? encrypt(v) : "");
      delete body.igAccessToken;
    }
    if (typeof body.igUserId === "string") {
      kvSet("ig_user_id", body.igUserId.trim());
      delete body.igUserId;
    }
    // API 키는 암호화해 저장하고 설정 본문에서 제거
    for (const name of ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "IMAGE_API_KEY", "CLOUDFLARE_API_TOKEN", "KLING_API_KEY"] as SecretName[]) {
      if (typeof body[name] === "string") {
        setSecret(name, body[name] as string);
        delete body[name];
      }
    }
    // 목소리 ID 칸에 API 키를 붙여넣는 실수를 저장 단계에서 막는다.
    // 저장돼 버리면 제작 중에 그 값이 주소에 실려 나가 오류 문구로 새어 나온다.
    if (body.tts && typeof body.tts === "object") {
      const tts = body.tts as { voiceId?: unknown; model?: unknown };
      const voiceId = typeof tts.voiceId === "string" ? tts.voiceId : "";
      const model = typeof tts.model === "string" ? tts.model : "";

      // 두 칸을 바꿔 넣은 경우가 가장 흔하다 — 어느 값이 어디로 가야 하는지까지 알려준다
      const swap = detectSwappedVoiceFields(voiceId, model);
      if (swap.swapped) return fail(swap.reason ?? "목소리 ID와 Model 칸을 확인해 주세요.");

      if (voiceId.trim()) {
        const check = checkVoiceId(voiceId);
        if (!check.ok) return fail(check.reason ?? "목소리 ID가 올바르지 않습니다.");
      }
      const modelCheck = checkTtsModel(model);
      if (!modelCheck.ok) return fail(modelCheck.reason ?? "Model 값이 올바르지 않습니다.");
    }
    // 내 PC 안에서만 열리는 주소를 넣으면 발행 단계에서 조용히 실패한다 → 저장 때 막는다
    if (typeof body.publicMediaBaseUrl === "string") {
      const check = checkPublicMediaUrl(body.publicMediaBaseUrl);
      if (!check.ok) return fail(check.reason ?? "영상 공개 주소를 확인해 주세요.");
      body.publicMediaBaseUrl = body.publicMediaBaseUrl.trim().replace(/\/$/, "");
    }
    // 공급자를 바꿨는데 예전 공급자의 모델 이름이 남으면 원인 모를 400이 난다 → 비운다
    if (typeof body.imageProvider === "string") {
      const provider = body.imageProvider as "gemini" | "openai" | "cloudflare" | "sample";
      const model = typeof body.imageModel === "string" ? body.imageModel : getSettings().imageModel;
      body.imageModel = clearStaleImageModel(provider, model);
    }
    try {
      const saved = saveSettings(body);
      return ok({ settings: saved, services: await serviceReady(), mode: getAppMode() });
    } catch (e) {
      return fail(`설정 값이 올바르지 않습니다: ${e instanceof Error ? e.message : e}`);
    }
  });
}
