import { handle, ok } from "@/lib/api";
import { getEnv, serviceReady } from "@/lib/env";
import { ffmpegStatus, ffmpegVersion } from "@/lib/ffmpeg";
import { getSettings } from "@/lib/settings";
import fs from "node:fs";
import { FONT_BOLD } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const env = getEnv();
    const ff = ffmpegStatus();
    return ok({
      mode: env.APP_MODE,
      services: serviceReady(env),
      ffmpeg: { ...ff, version: ff.found ? await ffmpegVersion() : null },
      fonts: { korean: fs.existsSync(FONT_BOLD) },
      node: process.version,
      settings: { approvalMode: getSettings().approvalMode, wizardDone: getSettings().wizardDone },
    });
  });
}
