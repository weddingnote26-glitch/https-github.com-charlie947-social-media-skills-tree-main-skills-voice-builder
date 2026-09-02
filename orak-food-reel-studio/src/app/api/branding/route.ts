import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/settings";
import { brandingDir, resolveBrandImage, sniffImage } from "@/lib/pipeline/branding";

export const dynamic = "force-dynamic";

/** 그림 한 장 상한 — 로고·배너는 이보다 클 이유가 없다 */
const MAX_BYTES = 5 * 1024 * 1024;

function status() {
  const b = getSettings().branding;
  const one = (slot: "intro" | "outro") => {
    const abs = b[slot].file ? resolveBrandImage(b[slot].file) : null;
    return { file: b[slot].file, seconds: b[slot].seconds, exists: !!abs, path: abs };
  };
  return { intro: one("intro"), outro: one("outro"), applyToReels: b.applyToReels, applyToImported: b.applyToImported };
}

/** 인트로·아웃트로 현재 상태 */
export async function GET() {
  return handle(() => ok(status()));
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("upload"), slot: z.enum(["intro", "outro"]), dataUrl: z.string().min(16) }),
  z.object({ action: z.literal("clear"), slot: z.enum(["intro", "outro"]) }),
]);

/**
 * 그림 올리기 / 지우기.
 * 파일은 branding 폴더에 슬롯 이름(intro.png 등)으로 저장한다 — 이름을 사용자가 정하지 않으므로
 * 경로 조작이 끼어들 자리가 없다. 종류는 확장자가 아니라 내용의 첫 바이트로 정한다.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("요청 내용을 확인해 주세요.");
    const body = parsed.data;
    const cur = getSettings().branding;

    if (body.action === "clear") {
      // 설정에서만 뗀다 — 올려 둔 파일은 지우지 않는다 (사용자 파일은 지우지 않는다)
      const next = { ...cur, [body.slot]: { ...cur[body.slot], file: "" } };
      saveSettings({ branding: next });
      return ok(status());
    }

    const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(body.dataUrl);
    if (!m) return fail("그림 파일이 아닙니다. PNG · JPG · WEBP 파일을 골라 주세요.");
    if (m[2].length > MAX_BYTES * 1.4) return fail("그림이 너무 큽니다 (5MB 까지).");
    const buf = Buffer.from(m[2].replace(/\s/g, ""), "base64");
    if (buf.length === 0 || buf.length > MAX_BYTES) return fail("그림이 비어 있거나 너무 큽니다 (5MB 까지).");
    const kind = sniffImage(buf);
    if (!kind) return fail("PNG · JPG · WEBP 그림만 쓸 수 있습니다.");

    const dir = brandingDir();
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${body.slot}.${kind}`;
    fs.writeFileSync(path.join(dir, fileName), buf);
    const next = { ...cur, [body.slot]: { ...cur[body.slot], file: fileName } };
    saveSettings({ branding: next });
    return ok(status());
  });
}
