import { handle, ok, fail } from "@/lib/api";
import { masterReferenceStatus, ORAKI, ORAKI_SPEECH_SAMPLES, VERDICT_PHRASES } from "@/lib/character/oraki";
import { ORAKI_ACTIONS, ORAKI_EXPRESSIONS } from "@/lib/schema";
import { getSettings, saveSettings } from "@/lib/settings";
import { DIRS } from "@/lib/paths";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** §14~15 캐릭터 관리 — Master Reference + Character Lock */
export async function GET() {
  return handle(() => ok({
    character: ORAKI,
    references: masterReferenceStatus(),
    lock: getSettings().characterLock,
    actions: ORAKI_ACTIONS,
    expressions: ORAKI_EXPRESSIONS,
    speechSamples: ORAKI_SPEECH_SAMPLES,
    verdictPhrases: VERDICT_PHRASES,
  }));
}

/** 레퍼런스 이미지 업로드 (base64) */
export async function POST(req: Request) {
  return handle(async () => {
    const body = z.object({
      file: z.string().regex(/^[\w가-힣.-]+\.(png|jpg|jpeg)$/i, "png/jpg 파일명만 가능합니다"),
      dataBase64: z.string().min(100),
    }).parse(await req.json());
    const buf = Buffer.from(body.dataBase64.replace(/^data:[^,]+,/, ""), "base64");
    if (buf.length > 15 * 1024 * 1024) return fail("15MB 이하 이미지만 업로드할 수 있습니다");
    fs.mkdirSync(DIRS.character, { recursive: true });
    fs.writeFileSync(path.join(DIRS.character, body.file), buf);
    // 참조 목록에 자동 등록
    const lock = getSettings().characterLock;
    if (!lock.referenceImages.includes(body.file)) {
      saveSettings({ characterLock: { ...lock, referenceImages: [...lock.referenceImages, body.file] } });
    }
    return ok({ saved: body.file });
  });
}

/** Character Lock 설정 변경 */
export async function PATCH(req: Request) {
  return handle(async () => {
    const body = z.object({
      enabled: z.boolean().optional(),
      seed: z.number().int().optional(),
      referenceImages: z.array(z.string()).optional(),
    }).parse(await req.json());
    const lock = getSettings().characterLock;
    const saved = saveSettings({ characterLock: { ...lock, ...body } });
    return ok({ lock: saved.characterLock });
  });
}
