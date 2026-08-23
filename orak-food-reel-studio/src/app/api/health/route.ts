import { handle, ok } from "@/lib/api";
import { getEnv, serviceReady } from "@/lib/env";
import { ffmpegStatus, ffmpegVersion } from "@/lib/ffmpeg";
import { getSettings } from "@/lib/settings";
import { getAppMode } from "@/lib/secrets";
import fs from "node:fs";
import path from "node:path";
import { FONT_BOLD, ROOT } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const env = getEnv();
    const ff = ffmpegStatus();
    // 어떤 빌드가 돌고 있는지 (git pull 후 빌드를 건너뛰면 예전 코드가 돈다)
    let builtAt: string | null = null;
    try {
      builtAt = fs.statSync(path.join(ROOT, ".next", "BUILD_ID")).mtime.toISOString();
    } catch { /* 개발 모드 */ }

    return ok({
      builtAt,
      mode: getAppMode(),
      services: await serviceReady(env),
      ffmpeg: { ...ff, version: ff.found ? await ffmpegVersion() : null },
      fonts: { korean: fs.existsSync(FONT_BOLD) },
      node: process.version,
      settings: { approvalMode: getSettings().approvalMode, wizardDone: getSettings().wizardDone },
    });
  });
}
