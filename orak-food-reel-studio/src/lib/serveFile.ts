import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".mp3": "audio/mpeg", ".srt": "text/plain; charset=utf-8", ".ass": "text/plain; charset=utf-8",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8",
};

/** ROOT 내부 안전 경로만 서빙 + mp4 Range 지원 */
export function serveLocalFile(relParts: string[], baseDirs: string[], rangeHeader?: string | null): Response {
  const rel = relParts.join("/");
  if (rel.includes("..")) return new Response("잘못된 경로", { status: 400 });
  let abs: string | null = null;
  for (const base of baseDirs) {
    const cand = path.join(base, rel);
    const norm = path.resolve(cand);
    if (norm.startsWith(path.resolve(ROOT)) && fs.existsSync(norm) && fs.statSync(norm).isFile()) {
      abs = norm;
      break;
    }
  }
  if (!abs) return new Response("파일이 없습니다", { status: 404 });

  const mime = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const size = fs.statSync(abs).size;

  if (rangeHeader) {
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (m) {
      const start = m[1] ? parseInt(m[1]) : 0;
      const end = m[2] ? Math.min(parseInt(m[2]), size - 1) : Math.min(start + 4 * 1024 * 1024, size - 1);
      const stream = fs.createReadStream(abs, { start, end });
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          "content-type": mime,
          "content-range": `bytes ${start}-${end}/${size}`,
          "accept-ranges": "bytes",
          "content-length": String(end - start + 1),
        },
      });
    }
  }
  const stream = fs.createReadStream(abs);
  return new Response(stream as unknown as ReadableStream, {
    headers: { "content-type": mime, "content-length": String(size), "accept-ranges": "bytes" },
  });
}
