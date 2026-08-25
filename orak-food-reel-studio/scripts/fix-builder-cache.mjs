#!/usr/bin/env node
/**
 * electron-builder 의 코드 서명 도구 캐시를 미리 풀어 둔다.
 *
 * 왜 필요한가:
 * electron-builder 는 winCodeSign 이라는 꾸러미를 받아서 푼다.
 * 그 안에는 **macOS 용 심볼릭 링크**(libcrypto.dylib, libssl.dylib)가 들어 있는데,
 * Windows 에서 심볼릭 링크를 만들려면 관리자 권한이나 개발자 모드가 필요하다.
 * 없으면 이렇게 실패한다.
 *
 *   ERROR: Cannot create symbolic link : 클라이언트에 필요한 권한이 없습니다
 *
 * 우리는 코드 서명을 하지 않으므로 그 macOS 부분은 아예 필요가 없다.
 * 그래서 여기서 darwin 폴더를 빼고 미리 풀어 둔다.
 * 폴더가 이미 있으면 electron-builder 는 다시 풀지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const g = (s) => `\x1b[32m${s}\x1b[0m`;
const y = (s) => `\x1b[33m${s}\x1b[0m`;

if (os.platform() !== "win32") {
  console.log("  (Windows 가 아니므로 건너뜁니다)");
  process.exit(0);
}

const cacheRoot = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "electron-builder", "Cache", "winCodeSign",
);

if (!fs.existsSync(cacheRoot)) {
  console.log("  아직 받은 것이 없습니다. 그대로 진행합니다.");
  process.exit(0);
}

/** 함께 들어 있는 7z 실행 파일 */
function find7za() {
  try {
    const p = require_.resolve("7zip-bin/win/x64/7za.exe");
    if (fs.existsSync(p)) return p;
  } catch { /* 아래에서 직접 찾는다 */ }
  const guess = path.join(process.cwd(), "node_modules", "7zip-bin", "win", "x64", "7za.exe");
  return fs.existsSync(guess) ? guess : null;
}

const seven = find7za();
if (!seven) {
  console.log(y("  7za 를 찾지 못했습니다. 그대로 진행합니다."));
  process.exit(0);
}

let fixed = 0;
for (const name of fs.readdirSync(cacheRoot)) {
  if (!name.endsWith(".7z")) continue;
  const archive = path.join(cacheRoot, name);
  const target = path.join(cacheRoot, name.replace(/\.7z$/, ""));

  // 앞서 실패해 반쯤 풀린 폴더가 남아 있으면 지우고 다시 푼다
  const looksDone = fs.existsSync(path.join(target, "windows-10"));
  if (looksDone) { console.log(`  이미 준비됨: ${name}`); continue; }
  fs.rmSync(target, { recursive: true, force: true });

  console.log(`  푸는 중: ${name}  (macOS 부분 제외)`);
  try {
    execFileSync(seven, ["x", "-y", "-bd", `-o${target}`, archive, "-xr!darwin"], { stdio: "pipe" });
    fixed++;
  } catch (e) {
    console.log(y(`  ! ${name} 을 풀지 못했습니다: ${(e.message || "").slice(0, 120)}`));
  }
}

if (fixed > 0) console.log(g(`  ✅ ${fixed}개 준비 완료 — 이제 관리자 권한 없이 만들 수 있습니다`));
else console.log("  손댈 것이 없었습니다.");
