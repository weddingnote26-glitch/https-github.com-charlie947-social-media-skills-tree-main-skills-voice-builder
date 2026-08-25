#!/usr/bin/env node
/** 환경 점검 + 준비 — start.bat이 서버 실행 전에 호출합니다. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import { execSync } from "node:child_process";
import { checkCloudSync } from "./cloud-check.mjs";

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
/**
 * 왜 안 되는지까지 가려낸다.
 * "찾을 수 없습니다" 만으로는 npm install 을 다시 하라는 안내가 맞는지 알 수 없다.
 *   - 패키지 없음      → 설치가 덜 된 것
 *   - 실행 파일 없음    → 설치 중 다운로드가 막힌 것 (방화벽·백신)
 *   - 실행 안 됨       → 백신이 격리했거나 손상된 것
 */
function inspectFFmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "pipe" }); return { state: "ok", how: "ffmpeg (시스템 설치)" }; } catch { /* 다음 */ }
  let binPath = null;
  try { binPath = require_("ffmpeg-static"); } catch { return { state: "no-package" }; }
  if (!binPath || !fs.existsSync(binPath)) return { state: "no-binary", binPath };
  try { execFileSync(binPath, ["-version"], { stdio: "pipe" }); return { state: "ok", how: "ffmpeg-static (자동 설치본)" }; }
  catch { return { state: "broken", binPath }; }
}

let ff = inspectFFmpeg();

// 실행 파일만 없는 경우는 그 자리에서 받아 고친다 (한글 폰트와 같은 방식)
if (ff.state === "no-binary" || ff.state === "broken") {
  process.stdout.write("  ⬇️  FFmpeg 실행 파일을 내려받는 중… (30~80MB, 1~3분) ");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "fix-ffmpeg.mjs")], { stdio: "pipe" });
    console.log("완료");
    ff = inspectFFmpeg();
  } catch {
    console.log("실패");
  }
}

if (ff.state === "ok") ok(`FFmpeg 사용 가능 — ${ff.how}`);
else if (ff.state === "no-package") {
  bad("FFmpeg 패키지가 설치되지 않았습니다. 검은 창에서 npm install 을 실행한 뒤 다시 시작하세요.");
} else if (ff.state === "broken") {
  bad(`FFmpeg 파일이 있지만 실행되지 않습니다. 백신이 격리했을 수 있습니다.\n     아래 폴더를 백신 예외로 등록한 뒤 npm run ffmpeg 를 실행하세요.\n     ${path.dirname(ff.binPath)}`);
} else {
  bad("FFmpeg 실행 파일을 내려받지 못했습니다 (회사 방화벽이 github.com 을 막는 경우가 많습니다).\n" +
      "     ① 검은 창에서 npm run ffmpeg 를 다시 실행해 보세요.\n" +
      "     ② 그래도 안 되면 https://www.gyan.dev/ffmpeg/builds/ 에서 ffmpeg-release-essentials.zip 을 받아\n" +
      "        압축을 풀고 bin 폴더를 시스템 PATH 에 추가한 뒤 프로그램을 다시 켜세요.");
}

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

// 6) 빌드 여부 + 언제 만든 것인지
if (fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
  let when = "";
  try { when = ` (${fs.statSync(path.join(ROOT, ".next", "BUILD_ID")).mtime.toLocaleString("ko-KR")})`; } catch { /* 없어도 그만 */ }
  ok(`프로그램 빌드 확인${when}`);
}
else warn("첫 실행이라 빌드가 필요합니다 — start.bat이 자동으로 진행합니다 (몇 분 걸릴 수 있어요).");

// 7) 클라우드 동기화 폴더 — 빌드가 EPERM 으로 멈추는 가장 흔한 원인
{
  let tasks = "";
  if (os.platform() === "win32") {
    try { tasks = execSync("tasklist /fo csv /nh", { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { /* 막혀 있으면 경로만으로 판단 */ }
  }
  const cloud = checkCloudSync({ dir: ROOT, home: os.homedir(), platform: os.platform(), taskListOutput: tasks });
  if (cloud.level === "sure") {
    warn(`${cloud.service} 동기화 폴더 안에 있습니다 — 빌드가 실패하면 동기화를 잠시 멈추거나 C:\\orak 같은 자리로 옮기세요.`);
  } else if (cloud.level === "maybe") {
    warn(`${cloud.service}가 켜져 있고 프로그램이 개인 폴더 안에 있습니다 — 빌드가 EPERM 으로 멈추면 동기화를 잠시 멈춰 보세요.`);
  } else {
    ok("클라우드 동기화 폴더 아님");
  }
}

console.log(problems === 0 ? "\n모든 점검 통과! 🎉\n" : `\n${problems}개 항목을 해결해야 합니다.\n`);
process.exit(problems === 0 ? 0 : 1);
