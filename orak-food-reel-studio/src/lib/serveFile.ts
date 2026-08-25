import fs from "node:fs";
import path from "node:path";


const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".mp3": "audio/mpeg", ".srt": "text/plain; charset=utf-8", ".ass": "text/plain; charset=utf-8",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8",
};

/** 허용된 폴더 안의 파일인가 — 각 기준 폴더 자기 자신을 기준으로 본다 */
export function insideAllowed(absPath: string, baseDirs: string[]): boolean {
  const norm = path.resolve(absPath);
  return baseDirs.some((base) => {
    const b = path.resolve(base);
    return norm === b || norm.startsWith(b + path.sep);
  });
}

/**
 * 허용 폴더 안의 안전 경로만 서빙 + mp4 Range 지원.
 *
 * 예전에는 ROOT 안쪽만 허용했다. 설치형 앱은 완성 영상을 ROOT 밖
 * (내 문서\오락푸드 AI릴스\완성영상)에 두므로, 주소가 맞아도 404 가 났다 —
 * 화면마다 "영상 없음" 이 뜬 원인의 절반이 이것이다.
 * 허용 목록은 부르는 쪽이 넘긴 baseDirs 그 자체다.
 */
export function serveLocalFile(relParts: string[], baseDirs: string[], rangeHeader?: string | null): Response {
  const rel = relParts.join("/");
  if (rel.includes("..")) return new Response("잘못된 경로", { status: 400 });
  let abs: string | null = null;
  for (const base of baseDirs) {
    const cand = path.resolve(path.join(base, rel));
    if (insideAllowed(cand, [base]) && fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      abs = cand;
      break;
    }
  }
  if (!abs) return new Response("파일이 없습니다", { status: 404 });
  return serveAbsolute(abs, rangeHeader);
}

/** 이미 검증된 절대 경로를 그대로 서빙한다 (Range 지원) */
export function serveAbsolute(abs: string, rangeHeader?: string | null): Response {

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
