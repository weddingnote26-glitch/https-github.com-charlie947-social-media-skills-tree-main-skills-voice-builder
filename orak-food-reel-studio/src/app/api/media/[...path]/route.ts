import { serveLocalFile, serveAbsolute, insideAllowed } from "@/lib/serveFile";
import { DIRS, ROOT } from "@/lib/paths";
import fs from "node:fs";

export const dynamic = "force-dynamic";

/**
 * 미리보기용 내부 미디어 서빙 (output + assets).
 *
 * /api/media/abs?p=<절대 경로> — 화면은 서버의 폴더 구조를 모른다.
 * 설치형 앱은 완성 영상이 "내 문서\...\완성영상" 에 있어 상대 경로를 만들 수 없으므로
 * 절대 경로를 그대로 받되, 허용 폴더(output·assets·ROOT) 안인지는 서버가 검사한다.
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const range = req.headers.get("range");

  if (parts.length === 1 && parts[0] === "abs") {
    const raw = new URL(req.url).searchParams.get("p") ?? "";
    const abs = raw.replace(/\\/g, "/");
    if (!abs || abs.includes("..")) return new Response("잘못된 경로", { status: 400 });
    if (!insideAllowed(abs, [DIRS.output, DIRS.assets, ROOT])) {
      return new Response("허용되지 않은 경로", { status: 403 });
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return new Response("파일이 없습니다", { status: 404 });
    }
    return serveAbsolute(abs, range);
  }

  return serveLocalFile(parts, [ROOT, DIRS.output, DIRS.assets], range);
}
