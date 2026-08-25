import path from "node:path";
import fs from "node:fs";
import { DIRS } from "../paths";

/**
 * Master Reference 이미지 보관함.
 *
 * assets/character/ 아래를 폴더 단위로 정리한다.
 *  - 뿌리(루트)에 있는 파일은 폴더 이름이 "" 이다 (예전부터 있던 7종이 여기 있다)
 *  - 하위 폴더는 한 단계만 쓴다. 폴더 안의 폴더는 만들지 않는다 —
 *    화면에서 길을 잃기 쉽고, 참조 목록에 넣을 때도 헷갈린다.
 *
 * 설정에는 "front.png" 또는 "주인공/hero.png" 처럼 상대 경로로 저장한다.
 * 예전 설정(파일명만 들어 있는 값)도 그대로 동작한다.
 */

export const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** 폴더·파일 이름으로 쓸 수 없는 글자 (윈도우 기준까지 포함) */
const BAD_NAME = /[\\/:*?"<>|]/;

/**
 * §14 Character Master Reference 파일 목록.
 * oraki.ts 가 아니라 여기에 둔다 — oraki.ts 는 resolveRef 를 쓰므로,
 * 반대로 여기서 oraki.ts 를 불러오면 순환 참조가 되어 빌드가 깨진다.
 */
export const MASTER_REFERENCE_FILES = [
  "front.png", "side.png", "back.png",
  "face_happy.png", "face_surprised.png", "face_detective.png",
  "character_sheet.png",
] as const;

/** 기본 제공 7종 — 지우면 오락이 기준이 사라지므로 화면에서 구분해 보여준다 */
export const PROTECTED_FILES: readonly string[] = MASTER_REFERENCE_FILES;

export interface RefImage {
  /** 설정에 저장되는 값 — "front.png" 또는 "주인공/hero.png" */
  rel: string;
  file: string;
  folder: string;
  path: string;
  sizeKb: number;
  /** 기본 제공 파일인지 */
  builtin: boolean;
}

export interface RefFolder {
  name: string;       // "" 이면 기본 폴더(루트)
  count: number;
}

/* ---------- 이름 검사 ---------- */

export function isValidFolderName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (n.length > 40) return false;
  if (n === "." || n === "..") return false;
  if (BAD_NAME.test(n)) return false;
  if (n.startsWith(".")) return false;
  // svg/ 는 캐릭터 원본 SVG 가 들어 있는 자리라 건드리지 않는다
  if (n.toLowerCase() === "svg") return false;
  return true;
}

/**
 * 설정에 저장된 상대 경로를 실제 파일 경로로 바꾼다.
 * assets/character 밖으로 나가는 값은 무조건 거부한다(경로 탈출 방지).
 */
export function resolveRef(rel: string): string | null {
  const cleaned = String(rel ?? "").replace(/\\/g, "/").trim();
  if (!cleaned || cleaned.startsWith("/")) return null;
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;          // 한 단계까지만
  if (parts.some((p) => p === "." || p === ".." || BAD_NAME.test(p))) return null;
  if (!IMAGE_EXT.test(parts[parts.length - 1])) return null;

  const abs = path.resolve(DIRS.character, ...parts);
  const root = path.resolve(DIRS.character);
  // resolve 후에도 뿌리 안에 있는지 다시 확인한다 (심볼릭 링크·대소문자 등)
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function relOf(folder: string, file: string): string {
  return folder ? `${folder}/${file}` : file;
}

/* ---------- 조회 ---------- */

function listImagesIn(dirAbs: string, folder: string): RefImage[] {
  if (!fs.existsSync(dirAbs)) return [];
  return fs.readdirSync(dirAbs, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXT.test(e.name))
    .map((e) => {
      const abs = path.join(dirAbs, e.name);
      let sizeKb = 0;
      try { sizeKb = Math.round(fs.statSync(abs).size / 1024); } catch { /* 지워지는 중일 수 있다 */ }
      return {
        rel: relOf(folder, e.name),
        file: e.name,
        folder,
        path: abs,
        sizeKb,
        builtin: folder === "" && PROTECTED_FILES.includes(e.name),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file, "ko"));
}

export function listFolders(): RefFolder[] {
  fs.mkdirSync(DIRS.character, { recursive: true });
  const subs = fs.readdirSync(DIRS.character, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidFolderName(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "ko"));
  return [
    { name: "", count: listImagesIn(DIRS.character, "").length },
    ...subs.map((name) => ({ name, count: listImagesIn(path.join(DIRS.character, name), name).length })),
  ];
}

export function listImages(): RefImage[] {
  const out = listImagesIn(DIRS.character, "");
  for (const f of listFolders()) {
    if (!f.name) continue;
    out.push(...listImagesIn(path.join(DIRS.character, f.name), f.name));
  }
  return out;
}

/* ---------- 폴더 ---------- */

export function createFolder(name: string): { created: string } {
  const n = name.trim();
  if (!isValidFolderName(n)) {
    throw new Error(`폴더 이름으로 쓸 수 없습니다: "${name}". \\ / : * ? " < > | 는 넣을 수 없고, svg 는 예약된 이름입니다.`);
  }
  const abs = path.join(DIRS.character, n);
  if (fs.existsSync(abs)) throw new Error(`"${n}" 폴더가 이미 있습니다.`);
  fs.mkdirSync(abs, { recursive: true });
  return { created: n };
}

export function renameFolder(from: string, to: string): { from: string; to: string; moved: string[] } {
  const a = from.trim();
  const b = to.trim();
  if (!a) throw new Error("기본 폴더는 이름을 바꿀 수 없습니다.");
  if (!isValidFolderName(a) || !isValidFolderName(b)) throw new Error(`폴더 이름으로 쓸 수 없습니다: "${to}"`);
  const src = path.join(DIRS.character, a);
  const dst = path.join(DIRS.character, b);
  if (!fs.existsSync(src)) throw new Error(`"${a}" 폴더가 없습니다.`);
  if (a !== b && fs.existsSync(dst)) throw new Error(`"${b}" 폴더가 이미 있습니다.`);
  const files = listImagesIn(src, a).map((i) => i.file);
  fs.renameSync(src, dst);
  return { from: a, to: b, moved: files.map((f) => relOf(b, f)) };
}

/**
 * 폴더 삭제.
 * mode="move" 면 안의 이미지를 기본 폴더로 옮기고 폴더만 지운다(기본값 — 안전한 쪽).
 * mode="delete" 면 안의 이미지까지 함께 지운다.
 */
export function deleteFolder(name: string, mode: "move" | "delete"): { folder: string; movedTo: string[]; deleted: string[] } {
  const n = name.trim();
  if (!n) throw new Error("기본 폴더는 삭제할 수 없습니다.");
  if (!isValidFolderName(n)) throw new Error(`폴더 이름이 올바르지 않습니다: "${name}"`);
  const src = path.join(DIRS.character, n);
  if (!fs.existsSync(src)) throw new Error(`"${n}" 폴더가 없습니다.`);

  const images = listImagesIn(src, n);
  const movedTo: string[] = [];
  const deleted: string[] = [];

  if (mode === "move") {
    for (const img of images) {
      const target = uniqueRootName(img.file);
      fs.renameSync(img.path, path.join(DIRS.character, target));
      movedTo.push(target);
    }
  } else {
    for (const img of images) {
      fs.rmSync(img.path, { force: true });
      deleted.push(img.rel);
    }
  }
  // 이미지가 아닌 파일이 남아 있으면 폴더가 지워지지 않는다 — 통째로 지운다
  fs.rmSync(src, { recursive: true, force: true });
  return { folder: n, movedTo, deleted };
}

/** 기본 폴더에 같은 이름이 있으면 뒤에 번호를 붙인다 */
function uniqueRootName(file: string): string {
  if (!fs.existsSync(path.join(DIRS.character, file))) return file;
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}-${i}${ext}`;
    if (!fs.existsSync(path.join(DIRS.character, cand))) return cand;
  }
  throw new Error(`"${file}" 과 이름이 겹치는 파일이 너무 많습니다.`);
}

/* ---------- 이미지 ---------- */

export function deleteImages(rels: string[]): { deleted: string[]; missing: string[] } {
  const deleted: string[] = [];
  const missing: string[] = [];
  for (const rel of [...new Set(rels)]) {
    const abs = resolveRef(rel);
    // 이미 없는 파일은 조용히 넘어간다 — 새로고침 후 같은 버튼을 눌러도 오류가 나지 않게
    if (!abs || !fs.existsSync(abs)) { missing.push(rel); continue; }
    fs.rmSync(abs, { force: true });
    deleted.push(rel);
  }
  return { deleted, missing };
}

export function moveImages(rels: string[], toFolder: string): { moved: Array<{ from: string; to: string }>; missing: string[] } {
  const folder = toFolder.trim();
  if (folder && !isValidFolderName(folder)) throw new Error(`폴더 이름이 올바르지 않습니다: "${toFolder}"`);
  const dstDir = folder ? path.join(DIRS.character, folder) : DIRS.character;
  if (folder && !fs.existsSync(dstDir)) throw new Error(`"${folder}" 폴더가 없습니다.`);

  const moved: Array<{ from: string; to: string }> = [];
  const missing: string[] = [];
  for (const rel of [...new Set(rels)]) {
    const abs = resolveRef(rel);
    if (!abs || !fs.existsSync(abs)) { missing.push(rel); continue; }
    const file = path.basename(abs);
    let target = path.join(dstDir, file);
    if (path.resolve(target) === path.resolve(abs)) continue; // 같은 자리
    if (fs.existsSync(target)) {
      const unique = folder ? uniqueIn(dstDir, file) : uniqueRootName(file);
      target = path.join(dstDir, unique);
    }
    fs.renameSync(abs, target);
    moved.push({ from: rel, to: relOf(folder, path.basename(target)) });
  }
  return { moved, missing };
}

function uniqueIn(dir: string, file: string): string {
  if (!fs.existsSync(path.join(dir, file))) return file;
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}-${i}${ext}`;
    if (!fs.existsSync(path.join(dir, cand))) return cand;
  }
  throw new Error(`"${file}" 과 이름이 겹치는 파일이 너무 많습니다.`);
}
