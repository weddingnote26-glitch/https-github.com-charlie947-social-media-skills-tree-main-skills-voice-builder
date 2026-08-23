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

/**
 * ffmpeg-static 은 설치할 때 실행 파일을 인터넷에서 내려받는다.
 * 회사 방화벽이나 백신이 그 다운로드를 막으면 패키지 폴더는 있는데 실행 파일만 없다.
 * 그때 require 는 성공하고 "경로"를 돌려주므로, 파일이 실제로 있는지 확인하지 않으면
 * 한참 뒤 영상 렌더링 도중에야 알 수 없는 오류로 터진다.
 */
function existing(p: string | null | undefined): string | null {
  if (!p) return null;
  try { return fs.existsSync(p) ? p : null; } catch { return null; }
}

export function findFFmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath;
  // 설치본에는 FFmpeg 가 함께 들어 있다 — 다운로드나 PATH 에 기대지 않는다
  ffmpegPath = existing(process.env.ORAK_FFMPEG_PATH);
  if (ffmpegPath) return ffmpegPath;
  ffmpegPath = which("ffmpeg");
  if (!ffmpegPath) {
    try { ffmpegPath = existing(require_("ffmpeg-static") as string); } catch { ffmpegPath = null; }
  }
  return ffmpegPath;
}

export function findFFprobe(): string | null {
  if (ffprobePath !== undefined) return ffprobePath;
  ffprobePath = existing(process.env.ORAK_FFPROBE_PATH);
  if (ffprobePath) return ffprobePath;
  ffprobePath = which("ffprobe");
  if (!ffprobePath) {
    try { ffprobePath = existing((require_("ffprobe-static") as { path: string }).path); } catch { ffprobePath = null; }
  }
  return ffprobePath;
}

/** 테스트·자동복구 후 다시 찾게 하려고 기억을 지운다 */
export function resetFFmpegCache(): void {
  ffmpegPath = undefined;
  ffprobePath = undefined;
}

export const FFMPEG_INSTALL_GUIDE =
  "FFmpeg를 찾을 수 없습니다. 검은 창에서 npm run ffmpeg 를 실행하면 자동으로 내려받습니다. " +
  "그래도 안 되면 https://www.gyan.dev/ffmpeg/builds/ 에서 ffmpeg-release-essentials.zip 을 받아 " +
  "압축을 풀고 bin 폴더를 시스템 PATH에 추가한 뒤, 새 창에서 ffmpeg -version 으로 확인하세요.";

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
