import { serveLocalFile } from "@/lib/serveFile";
import { DIRS } from "@/lib/paths";

export const dynamic = "force-dynamic";

/** §32 완성 영상 공개 서빙 — PUBLIC_MEDIA_BASE_URL/output/... 이 이 경로로 옵니다 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  return serveLocalFile(parts, [DIRS.output], req.headers.get("range"));
}
