import path from "node:path";
import fs from "node:fs";

/** 프로젝트 루트 (next dev/build 모두 CWD가 프로젝트 루트) */
export const ROOT = process.cwd();

export const DIRS = {
  data: path.join(ROOT, "data"),
  assets: path.join(ROOT, "assets"),
  images: path.join(ROOT, "assets", "images"),
  audio: path.join(ROOT, "assets", "audio"),
  video: path.join(ROOT, "assets", "video"),
  thumb: path.join(ROOT, "assets", "thumb"),
  subtitles: path.join(ROOT, "assets", "subtitles"),
  bgm: path.join(ROOT, "assets", "bgm"),
  character: path.join(ROOT, "assets", "character"),
  fonts: path.join(ROOT, "assets", "fonts"),
  output: path.join(ROOT, "output"),
  logs: path.join(ROOT, "logs"),
  templates: path.join(ROOT, "templates"),
  sample: path.join(ROOT, "sample"),
} as const;

export function ensureDirs(): void {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
}

/** 콘텐츠별 출력 폴더: /output/2026-08-24_shillim-restaurant/ */
export function reelOutputDir(date: string, slug: string): string {
  const dir = path.join(DIRS.output, `${date}_${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const FONT_MEDIUM = path.join(DIRS.fonts, "NotoSansKR-Medium.ttf");
export const FONT_BOLD = path.join(DIRS.fonts, "NotoSansKR-ExtraBold.ttf");
