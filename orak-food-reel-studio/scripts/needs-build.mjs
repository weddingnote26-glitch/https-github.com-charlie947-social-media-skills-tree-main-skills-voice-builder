/**
 * 다시 빌드해야 하는지 판단한다.
 *   종료 코드 1 = 빌드 필요 / 0 = 최신
 *
 * git pull 로 코드를 받아도 .next 가 남아 있으면 예전 화면이 그대로 돌아가는 문제를 막는다.
 * (소스 파일이 빌드 결과보다 새로우면 다시 빌드)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_ID = path.join(ROOT, ".next", "BUILD_ID");

if (!fs.existsSync(BUILD_ID)) {
  console.log("빌드 결과가 없습니다.");
  process.exit(1);
}
const builtAt = fs.statSync(BUILD_ID).mtimeMs;

const WATCH_DIRS = ["src", "scripts"];
const WATCH_FILES = ["package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"];

let newest = 0;
let newestFile = "";

function scan(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { scan(full); continue; }
    try {
      const m = fs.statSync(full).mtimeMs;
      if (m > newest) { newest = m; newestFile = path.relative(ROOT, full); }
    } catch { /* 무시 */ }
  }
}

for (const d of WATCH_DIRS) scan(path.join(ROOT, d));
for (const f of WATCH_FILES) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) continue;
  const m = fs.statSync(full).mtimeMs;
  if (m > newest) { newest = m; newestFile = f; }
}

if (newest > builtAt) {
  console.log(`새 코드가 있습니다 (${newestFile}).`);
  process.exit(1);
}
console.log("빌드가 최신입니다.");
process.exit(0);
