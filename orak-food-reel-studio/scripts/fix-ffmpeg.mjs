#!/usr/bin/env node
/**
 * FFmpeg 실행 파일 자동 복구.
 *
 * ffmpeg-static 은 설치할 때 GitHub 에서 실행 파일을 내려받는데,
 * 회사 방화벽·백신이 그 다운로드를 막으면 폴더만 생기고 파일은 없다.
 * npm install 을 다시 해도 이미 설치된 것으로 보여 건너뛰는 경우가 많다.
 * 그래서 여기서 직접 받아 넣는다.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const y = (s) => `\x1b[33m${s}\x1b[0m`;

function targetPath() {
  try {
    return require_("ffmpeg-static");
  } catch {
    // 패키지 자체가 없으면 놓일 자리를 직접 계산한다
    const name = os.platform() === "win32" ? "ffmpeg.exe" : "ffmpeg";
    return path.join(process.cwd(), "node_modules", "ffmpeg-static", name);
  }
}

function releaseTag() {
  try {
    const pkg = require_("ffmpeg-static/package.json");
    return pkg[pkg.name]["binary-release-tag"];
  } catch {
    return "b6.1.1";
  }
}

function works(bin) {
  try { execFileSync(bin, ["-version"], { stdio: "pipe" }); return true; } catch { return false; }
}

const bin = targetPath();
console.log("");
console.log("  FFmpeg 복구");
console.log("  놓일 자리:", bin);
console.log("");

if (fs.existsSync(bin) && works(bin)) {
  console.log(g("  ✅ 이미 정상입니다. 할 일이 없습니다."));
  process.exit(0);
}
if (fs.existsSync(bin)) {
  console.log(y("  ⚠ 파일은 있지만 실행되지 않습니다. 다시 받습니다."));
  console.log(y("     (백신이 막고 있다면 아래 폴더를 예외로 등록해 주세요)"));
  console.log("     " + path.dirname(bin));
  try { fs.rmSync(bin, { force: true }); } catch { /* 계속 진행 */ }
}

const arch = process.env.npm_config_arch || os.arch();
const platform = process.env.npm_config_platform || os.platform();
const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${releaseTag()}/ffmpeg-${platform}-${arch}.gz`;

console.log("  받는 곳:", url);
console.log("  내려받는 중… (약 30~80MB, 1~3분 걸릴 수 있습니다)");

try {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  const tmp = bin + ".download";
  // .gz 로 내려오므로 풀면서 저장한다
  await pipeline(Readable.fromWeb(res.body), zlib.createGunzip(), fs.createWriteStream(tmp));
  fs.renameSync(tmp, bin);
  if (platform !== "win32") fs.chmodSync(bin, 0o755);
} catch (e) {
  console.log("");
  console.log(r("  ❌ 내려받지 못했습니다: " + (e instanceof Error ? e.message : String(e))));
  console.log("");
  console.log("  아래 중 하나로 해결해 주세요.");
  console.log("");
  console.log("  1) 회사 방화벽이 github.com 을 막는 경우 — 직접 설치");
  console.log("     https://www.gyan.dev/ffmpeg/builds/ 에서");
  console.log("     ffmpeg-release-essentials.zip 을 받아 압축을 풀고,");
  console.log("     안의 bin 폴더를 시스템 PATH 에 추가한 뒤 프로그램을 다시 켜세요.");
  console.log("");
  console.log("  2) 백신이 막는 경우 — 아래 폴더를 예외로 등록한 뒤 다시 실행");
  console.log("     " + path.dirname(bin));
  console.log("");
  console.log("  3) 파일을 직접 받아 넣기");
  console.log("     " + url);
  console.log("     내려받아 압축(.gz)을 풀고 아래 이름으로 넣으세요.");
  console.log("     " + bin);
  process.exit(1);
}

if (works(bin)) {
  const v = execFileSync(bin, ["-version"], { stdio: "pipe" }).toString().split("\n")[0];
  console.log("");
  console.log(g("  ✅ 복구 완료 — " + v));
  console.log("     이제 start.bat 을 실행하세요.");
} else {
  console.log("");
  console.log(r("  ❌ 받기는 했지만 실행되지 않습니다."));
  console.log("     백신이 파일을 격리했을 수 있습니다. 아래 폴더를 예외로 등록하고 다시 실행해 주세요.");
  console.log("     " + path.dirname(bin));
  process.exit(1);
}
