import { handle, ok } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/settings";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** §53 첫 실행 Wizard 상태 */
export async function GET() {
  return handle(() => {
    const s = getSettings();
    return ok({ wizardDone: s.wizardDone, wizardStep: s.wizardStep });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = z.object({ step: z.number().int().min(1).max(8).optional(), done: z.boolean().optional() })
      .parse(await req.json());
    const saved = saveSettings({
      ...(body.step ? { wizardStep: body.step } : {}),
      ...(body.done !== undefined ? { wizardDone: body.done } : {}),
    });
    return ok({ wizardDone: saved.wizardDone, wizardStep: saved.wizardStep });
  });
}
