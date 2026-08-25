import path from "node:path";
import fs from "node:fs";

/**
 * 프로그램이 읽는 곳과 쓰는 곳.
 *
 * 두 가지 방식으로 실행된다.
 *
 *  1) 폴더에서 그대로 (start.bat)
 *     프로그램과 데이터가 한 폴더에 같이 있다. ORAK_HOME 이 없으므로 지금까지와 똑같다.
 *
 *  2) 설치본 (Electron)
 *     프로그램은 Program Files 처럼 쓰기 금지 폴더에 들어간다.
 *     그래서 데이터·영상·로그는 사용자 폴더로 옮겨야 한다.
 *     Electron 이 ORAK_HOME 을 넣어 주면 이 파일이 그쪽을 가리킨다.
 *
 * APP_ROOT 는 항상 프로그램이 설치된 자리다(읽기 전용 자원: 기본 오락이 이미지, 템플릿).
 */

/** 프로그램이 놓인 자리 — 읽기 전용 자원 */
export const APP_ROOT = process.cwd();

/** 데이터를 쓰는 자리 — 설치본에서는 사용자 폴더 */
export const ROOT = process.env.ORAK_HOME?.trim() || APP_ROOT;

/** 완성 영상만 따로 둘 수 있다 (설치본은 내 문서 아래) */
const OUTPUT_ROOT = process.env.ORAK_OUTPUT_DIR?.trim() || path.join(ROOT, "output");

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
  output: OUTPUT_ROOT,
  logs: path.join(ROOT, "logs"),
  templates: path.join(ROOT, "templates"),
  sample: path.join(ROOT, "sample"),
} as const;

/**
 * 설치본 첫 실행 때, 프로그램에 들어 있던 기본 자원을 사용자 폴더로 한 번 복사한다.
 * 이미 있는 파일은 건드리지 않는다 — 사용자가 바꾼 오락이 이미지를 덮어쓰면 안 된다.
 */
function seedFromApp(relative: string): void {
  if (ROOT === APP_ROOT) return;                    // 폴더 실행이면 옮길 필요가 없다
  const from = path.join(APP_ROOT, relative);
  const to = path.join(ROOT, relative);
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      seedDir(src, dst);
    } else if (!fs.existsSync(dst)) {
      try { fs.copyFileSync(src, dst); } catch { /* 한 파일 실패가 실행을 막지 않게 */ }
    }
  }
}

function seedDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) seedDir(src, dst);
    else if (!fs.existsSync(dst)) {
      try { fs.copyFileSync(src, dst); } catch { /* 계속 */ }
    }
  }
}

export function ensureDirs(): void {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
  // 오락이 기준 이미지와 템플릿은 프로그램에 들어 있다 → 첫 실행 때 사용자 폴더로
  seedFromApp(path.join("assets", "character"));
  seedFromApp(path.join("assets", "fonts"));
  seedFromApp("templates");
  seedFromApp("sample");
}

/** 콘텐츠별 출력 폴더: /output/2026-08-24_shillim-restaurant/ */
export function reelOutputDir(date: string, slug: string): string {
  const dir = path.join(DIRS.output, `${date}_${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const FONT_MEDIUM = path.join(DIRS.fonts, "NotoSansKR-Medium.ttf");
export const FONT_BOLD = path.join(DIRS.fonts, "NotoSansKR-ExtraBold.ttf");
