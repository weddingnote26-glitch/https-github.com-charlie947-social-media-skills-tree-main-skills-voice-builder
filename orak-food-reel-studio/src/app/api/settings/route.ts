import { handle, ok, fail } from "@/lib/api";
import { getSettings, saveSettings, kvSet } from "@/lib/settings";
import { encrypt } from "@/lib/crypto";
import { serviceReady } from "@/lib/env";
import { setSecret, secretStatus, getAppMode, type SecretName } from "@/lib/secrets";
import { clearStaleImageModel } from "@/lib/providers/image-model";

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
    },
  }));
}

export async function PUT(req: Request) {
  return handle(async () => {
    const body = await req.json() as Record<string, unknown>;
    // Instagram 토큰은 암호화 저장 (§31)
    if (typeof body.igAccessToken === "string" && body.igAccessToken.trim()) {
      kvSet("ig_token_encrypted", encrypt(body.igAccessToken.trim()));
      delete body.igAccessToken;
    }
    if (typeof body.igUserId === "string" && body.igUserId.trim()) {
      kvSet("ig_user_id", body.igUserId.trim());
      delete body.igUserId;
    }
    // API 키는 암호화해 저장하고 설정 본문에서 제거
    for (const name of ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "IMAGE_API_KEY"] as SecretName[]) {
      if (typeof body[name] === "string") {
        setSecret(name, body[name] as string);
        delete body[name];
      }
    }
    // 공급자를 바꿨는데 예전 공급자의 모델 이름이 남으면 원인 모를 400이 난다 → 비운다
    if (typeof body.imageProvider === "string") {
      const provider = body.imageProvider as "gemini" | "openai" | "sample";
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
