import { serveLocalFile } from "@/lib/serveFile";
import { DIRS, ROOT } from "@/lib/paths";

export const dynamic = "force-dynamic";

/** 미리보기용 내부 미디어 서빙 (output + assets) */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  return serveLocalFile(parts, [ROOT, DIRS.output, DIRS.assets], req.headers.get("range"));
}
