#!/usr/bin/env node
/**
 * 설치본에 넣을 파일만 골라 담는다.
 *
 * next build --output standalone 결과에는 개발용 파일과 **비밀값**이 섞여 들어온다.
 * 실제로 .env, data/.secret(암호화 열쇠), orak-studio.db(암호화된 API 키)가
 * 그대로 복사되는 것을 확인했다. 그대로 설치 파일을 만들면 키가 exe 안에 실려 나간다.
 * 그래서 여기서 담을 것을 고르고, 담은 뒤 다시 한 번 검사한다.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const ROOT = process.cwd();
const SRC = path.join(ROOT, ".next", "standalone");
const OUT = path.join(ROOT, "dist-app");

const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;

/** 설치본에 절대 들어가면 안 되는 것 */
const FORBIDDEN = [
  ".env", ".env.local", ".env.production",
  path.join("data", ".secret"),
  path.join("data", "orak-studio.db"),
];

/** 담지 않을 것 (비밀값 · 사용자 결과물 · 개발용) */
const SKIP = new Set([
  "data", "output", "logs", "src", "tests", "scripts", "electron", "node_modules/.cache",
  // 지난 빌드 결과를 다시 담으면 폴더가 자기 안에 자기를 품어 끝없이 커진다
  "dist-app", "dist-bin", "dist-installer",
  ".env", ".env.local", ".env.production", ".env.example",
  "tsconfig.tsbuildinfo", "vitest.config.ts", "tsconfig.json",
  "package-lock.json", "start.bat", "업데이트.bat",
]);

function copyDir(from, to, depth = 0) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (depth === 0 && SKIP.has(e.name)) continue;
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d, depth + 1);
    else if (e.isSymbolicLink()) { /* 링크는 건너뛴다 */ }
    else fs.copyFileSync(s, d);
  }
}

console.log("\n  설치본에 넣을 파일을 고릅니다");

// 지난 시도가 남긴 결과물을 먼저 치운다. 남아 있으면 다음 빌드가 그것을 다시 담는다.
for (const stale of ["dist-app", "dist-bin", "dist-installer"]) {
  const p = path.join(ROOT, stale);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`  지난 결과 정리: ${stale}`);
  }
}

if (!fs.existsSync(path.join(SRC, "server.js"))) {
  console.log(r("  ❌ .next/standalone 이 없습니다. 먼저 npm run build 를 실행하세요."));
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(SRC, OUT);

// standalone 은 .next/static 과 public 을 복사해 주지 않는다 — 없으면 화면이 깨진다
const staticFrom = path.join(ROOT, ".next", "static");
if (fs.existsSync(staticFrom)) copyDir(staticFrom, path.join(OUT, ".next", "static"));
const publicFrom = path.join(ROOT, "public");
if (fs.existsSync(publicFrom)) copyDir(publicFrom, path.join(OUT, "public"));

// 기본 자원은 있어야 첫 실행 때 사용자 폴더로 옮길 수 있다
for (const rel of [path.join("assets", "character"), path.join("assets", "fonts"), "templates", "sample"]) {
  const from = path.join(ROOT, rel);
  if (fs.existsSync(from)) copyDir(from, path.join(OUT, rel));
}

// FFmpeg 를 함께 담는다 (설치본이 다운로드에 기대지 않게)
const BIN = path.join(ROOT, "dist-bin");
fs.rmSync(BIN, { recursive: true, force: true });
fs.mkdirSync(BIN, { recursive: true });
let bundled = 0;
for (const [pkg, name] of [["ffmpeg-static", "ffmpeg"], ["ffprobe-static", "ffprobe"]]) {
  try {
    const mod = require_(pkg);
    const src = typeof mod === "string" ? mod : mod.path;
    if (src && fs.existsSync(src)) {
      const ext = path.extname(src);
      fs.copyFileSync(src, path.join(BIN, name + ext));
      bundled++;
    }
  } catch { /* 아래에서 경고 */ }
}

/* ── 담은 뒤 검사: 비밀값이 섞여 들어가지 않았는지 ───────────── */
const leaked = [];
for (const rel of FORBIDDEN) {
  if (fs.existsSync(path.join(OUT, rel))) leaked.push(rel);
}
// 혹시 모를 키 문자열이 남았는지 (파일 이름이 달라도 잡히게)
const KEY_LIKE = /\b(sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})\b/;
function scan(dir, depth = 0) {
  if (depth > 3) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") scan(p, depth + 1); continue; }
    if (!/\.(env|json|js|txt|md|db)$/i.test(e.name)) continue;
    try {
      if (fs.statSync(p).size > 4_000_000) continue;
      if (KEY_LIKE.test(fs.readFileSync(p, "utf8"))) leaked.push(path.relative(OUT, p));
    } catch { /* 이진 파일 등은 무시 */ }
  }
}
scan(OUT);

if (leaked.length) {
  console.log(r("\n  ❌ 비밀값이 설치본에 들어갔습니다. 중단합니다."));
  for (const l of [...new Set(leaked)]) console.log("     " + l);
  process.exit(1);
}

// 중첩이 생기면 설치 파일이 몇 배로 부푼다 — 담은 뒤 반드시 확인한다
for (const bad of ["dist-app", "dist-bin", "dist-installer"]) {
  if (fs.existsSync(path.join(OUT, bad))) {
    console.log(r(`\n  ❌ 설치본 안에 ${bad} 이(가) 들어갔습니다. 폴더가 자기 자신을 품게 됩니다.`));
    console.log("     dist-app / dist-bin / dist-installer 를 지우고 다시 실행하세요.");
    process.exit(1);
  }
}

const count = (d) => {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? count(path.join(d, e.name)) : 1;
  return n;
};
console.log(g(`  ✅ 준비 완료 — 파일 ${count(OUT)}개`));
console.log(`     앱      : ${OUT}`);
console.log(`     FFmpeg  : ${BIN} (${bundled}/2)`);
if (bundled < 2) console.log("     ⚠ FFmpeg 를 못 담았습니다. npm run ffmpeg 를 먼저 실행하세요.");
console.log(g("  ✅ 비밀값 검사 통과 — .env / .secret / DB / API 키 없음"));
