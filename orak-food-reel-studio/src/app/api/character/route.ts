import { handle, ok, fail } from "@/lib/api";
import { masterReferenceStatus, ORAKI, ORAKI_SPEECH_SAMPLES, VERDICT_PHRASES } from "@/lib/character/oraki";
import { ORAKI_ACTIONS, ORAKI_EXPRESSIONS } from "@/lib/schema";
import { getSettings, saveSettings } from "@/lib/settings";
import { isValidFolderName, resolveRef } from "@/lib/character/library";
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
      file: z.string().regex(/^[\w가-힣ㄱ-ㅎㅏ-ㅣ.\- ]+\.(png|jpg|jpeg|webp)$/i, "png/jpg/webp 파일만 올릴 수 있습니다"),
      folder: z.string().optional().default(""),
      dataBase64: z.string().min(100),
    }).parse(await req.json());
    const buf = Buffer.from(body.dataBase64.replace(/^data:[^,]+,/, ""), "base64");
    if (buf.length > 15 * 1024 * 1024) return fail("15MB 이하 이미지만 업로드할 수 있습니다");

    // 폴더 안으로 올리는 경우 — 이름을 검사해 assets/character 밖으로 나가지 못하게 한다
    const folder = body.folder.trim();
    if (folder && !isValidFolderName(folder)) return fail(`폴더 이름이 올바르지 않습니다: "${folder}"`);
    const dir = folder ? path.join(DIRS.character, folder) : DIRS.character;
    fs.mkdirSync(dir, { recursive: true });

    const rel = folder ? `${folder}/${body.file}` : body.file;
    if (!resolveRef(rel)) return fail("파일 경로가 올바르지 않습니다");
    fs.writeFileSync(path.join(dir, body.file), buf);

    // 참조 목록에 자동 등록
    const lock = getSettings().characterLock;
    if (!lock.referenceImages.includes(rel)) {
      saveSettings({ characterLock: { ...lock, referenceImages: [...lock.referenceImages, rel] } });
    }
    return ok({ saved: rel });
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
