import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { logError, logInfo } from "./log";

/**
 * §20 FFmpeg — 시스템 설치본 우선, 없으면 함께 설치되는 ffmpeg-static 사용.
 * 둘 다 없으면 설치 안내 메시지를 던짐.
 */
let ffmpegPath: string | null | undefined;
let ffprobePath: string | null | undefined;

const require_ = createRequire(import.meta.url);

function which(cmd: string): string | null {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
    for (const ext of exts) {
      const p = `${dir}/${cmd}${ext}`;
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* 계속 */ }
    }
  }
  return null;
}

export function findFFmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath;
  ffmpegPath = which("ffmpeg");
  if (!ffmpegPath) {
    try { ffmpegPath = require_("ffmpeg-static") as string; } catch { ffmpegPath = null; }
  }
  return ffmpegPath;
}

export function findFFprobe(): string | null {
  if (ffprobePath !== undefined) return ffprobePath;
  ffprobePath = which("ffprobe");
  if (!ffprobePath) {
    try { ffprobePath = (require_("ffprobe-static") as { path: string }).path; } catch { ffprobePath = null; }
  }
  return ffprobePath;
}

export const FFMPEG_INSTALL_GUIDE =
  "FFmpeg를 찾을 수 없습니다. ① 이 프로그램은 ffmpeg-static을 함께 설치하므로 보통 자동으로 해결됩니다 " +
  "(npm install 재실행). ② 직접 설치하려면 https://www.gyan.dev/ffmpeg/builds/ 에서 " +
  "ffmpeg-release-essentials.zip 을 받아 압축을 풀고, bin 폴더를 시스템 PATH에 추가한 뒤 " +
  "새 터미널에서 ffmpeg -version 으로 확인하세요.";

export function runFFmpeg(args: string[], timeoutMs = 10 * 60 * 1000): Promise<string> {
  const bin = findFFmpeg();
  if (!bin) return Promise.reject(new Error(FFMPEG_INSTALL_GUIDE));
  return runBin(bin, args, timeoutMs);
}

export function runFFprobe(args: string[]): Promise<string> {
  const bin = findFFprobe();
  if (!bin) return Promise.reject(new Error("ffprobe를 찾을 수 없습니다. " + FFMPEG_INSTALL_GUIDE));
  return runBin(bin, args, 60_000);
}

function runBin(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`FFmpeg 시간 초과 (${timeoutMs / 1000}s)`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out || err);
      else {
        logError("ffmpeg", `종료 코드 ${code}`, { tail: err.slice(-800) });
        reject(new Error(`FFmpeg 실패(코드 ${code}): ${err.slice(-800)}`));
      }
    });
  });
}

export async function ffmpegVersion(): Promise<string | null> {
  try {
    const out = await runFFmpeg(["-version"]);
    return out.split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

export function ffmpegStatus(): { found: boolean; path: string | null; probe: string | null } {
  const p = findFFmpeg();
  if (p) logInfo("ffmpeg", `사용 경로: ${p}`);
  return { found: !!p, path: p, probe: findFFprobe() };
}
