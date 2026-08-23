import { handle, ok, fail } from "@/lib/api";
import { getSettings, saveSettings, kvSet } from "@/lib/settings";
import { encrypt } from "@/lib/crypto";
import { serviceReady } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => ok({ settings: getSettings(), services: serviceReady() }));
}

export async function PUT(req: Request) {
  return handle(async () => {
    const body = await req.json();
    // Instagram 토큰은 암호화 저장 (§31)
    if (typeof body.igAccessToken === "string" && body.igAccessToken.trim()) {
      kvSet("ig_token_encrypted", encrypt(body.igAccessToken.trim()));
      delete body.igAccessToken;
    }
    if (typeof body.igUserId === "string" && body.igUserId.trim()) {
      kvSet("ig_user_id", body.igUserId.trim());
      delete body.igUserId;
    }
    try {
      const saved = saveSettings(body);
      return ok({ settings: saved });
    } catch (e) {
      return fail(`설정 값이 올바르지 않습니다: ${e instanceof Error ? e.message : e}`);
    }
  });
}
