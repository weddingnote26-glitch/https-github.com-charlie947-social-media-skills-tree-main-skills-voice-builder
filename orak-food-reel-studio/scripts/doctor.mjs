#!/usr/bin/env node
/** 환경 점검 + 준비 — start.bat이 서버 실행 전에 호출합니다. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require_ = createRequire(import.meta.url);
let problems = 0;

const ok = (msg) => console.log(`  ✅ ${msg}`);
const warn = (msg) => { console.log(`  ⚠️  ${msg}`); };
const bad = (msg) => { console.log(`  ❌ ${msg}`); problems++; };

console.log("\n🥟 오락푸드 AI 릴스 스튜디오 — 환경 점검\n");

// 1) Node
const major = parseInt(process.versions.node.split(".")[0]);
if (major >= 20) ok(`Node.js v${process.versions.node}`);
else bad(`Node.js v${process.versions.node} — 20 이상이 필요합니다. https://nodejs.org 에서 LTS 설치 후 다시 실행하세요.`);

// 이 프로그램은 C++ 컴파일이 필요한 모듈을 쓰지 않으므로 Visual Studio 등은 필요 없습니다.
if (fs.existsSync(path.join(ROOT, "node_modules", "better-sqlite3"))) {
  warn("예전 버전의 찌꺼기(better-sqlite3)가 남아 있습니다. node_modules 폴더를 지우고 start.bat 을 다시 실행하세요.");
}

// 2) 폴더
for (const d of ["data", "assets/images", "assets/audio", "assets/video", "assets/thumb", "assets/subtitles", "assets/bgm", "assets/character", "assets/fonts", "output", "logs", "templates"]) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true });
}
ok("작업 폴더 준비 완료 (data / assets / output / logs)");

// 3) .env
const envPath = path.join(ROOT, ".env");
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(ROOT, ".env.example"), envPath);
  warn(".env 파일이 없어 기본값으로 새로 만들었습니다 — API 키는 .env를 메모장으로 열어 채워 주세요. (Sample Mode로는 키 없이도 동작)");
} else ok(".env 파일 확인");

// 4) FFmpeg
let ffmpeg = null;
try { execFileSync("ffmpeg", ["-version"], { stdio: "pipe" }); ffmpeg = "ffmpeg (시스템 설치)"; } catch { /* 다음 */ }
if (!ffmpeg) {
  try {
    const p = require_("ffmpeg-static");
    if (p && fs.existsSync(p)) { execFileSync(p, ["-version"], { stdio: "pipe" }); ffmpeg = "ffmpeg-static (자동 설치본)"; }
  } catch { /* 없음 */ }
}
if (ffmpeg) ok(`FFmpeg 사용 가능 — ${ffmpeg}`);
else bad("FFmpeg를 찾을 수 없습니다. ① npm install 다시 실행(자동 설치) 또는 ② https://www.gyan.dev/ffmpeg/builds/ 에서 essentials zip을 받아 bin 폴더를 PATH에 추가하세요.");

// 5) 한글 폰트 (없으면 자동 다운로드 — SIL OFL 라이선스)
const fontsDir = path.join(ROOT, "assets", "fonts");
const manifest = JSON.parse(fs.readFileSync(path.join(fontsDir, "fonts.json"), "utf8"));
for (const f of manifest.fonts) {
  const target = path.join(fontsDir, f.file);
  if (fs.existsSync(target) && fs.statSync(target).size > 100000) { ok(`한글 폰트 ${f.file}`); continue; }
  try {
    process.stdout.write(`  ⬇️  한글 폰트 내려받는 중: ${f.file} ... `);
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log("완료");
  } catch (e) {
    console.log("실패");
    bad(`폰트 다운로드 실패(${e.message}) — 인터넷 연결 후 다시 실행하세요. 자막·썸네일에 한글 폰트가 필요합니다.`);
  }
}

// 6) 빌드 여부
if (fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) ok("프로그램 빌드 확인");
else warn("첫 실행이라 빌드가 필요합니다 — start.bat이 자동으로 진행합니다 (몇 분 걸릴 수 있어요).");

console.log(problems === 0 ? "\n모든 점검 통과! 🎉\n" : `\n${problems}개 항목을 해결해야 합니다.\n`);
process.exit(problems === 0 ? 0 : 1);
