import path from "node:path";
import fs from "node:fs";
import { DIRS } from "../paths";
import { runFFmpeg, runFFprobe } from "../ffmpeg";
import { getSettings } from "../settings";
import { logInfo, logWarn } from "../log";

/**
 * 인트로 · 아웃트로 — 영상 맨 앞과 맨 뒤에 로고·배너 그림을 붙인다.
 *
 * 핵심 렌더 그래프(render.ts)는 건드리지 않는다. 완성된 영상 파일을 받아 앞뒤에
 * 그림 장면을 이어 붙이는 뒤처리다. 그래서 맛집 릴스든 외부 영상이든 같은 코드로 붙고,
 * 실패해도 원래 영상은 그대로 남는다.
 *
 * 그림은 assets/branding/ 안의 파일 이름만 설정에 둔다 (경로 조작 방지 — 이름만 남긴다).
 */

export const BRANDING_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
export const OUT_FPS = 30;
export const MAX_CLIP_SEC = 10;
export const MIN_CLIP_SEC = 0.5;

export function brandingDir(): string {
  return path.join(DIRS.assets, "branding");
}

export interface BrandClip {
  imagePath: string;
  seconds: number;
}

export interface BrandingPlan {
  args: string[];
  introSec: number;
  outroSec: number;
  /** 원래 영상보다 늘어난 길이(초) */
  addedSec: number;
}

function clampSec(v: number | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 2;
  return Math.round(Math.min(MAX_CLIP_SEC, Math.max(MIN_CLIP_SEC, n)) * 10) / 10;
}

/**
 * FFmpeg 명령 (순수 함수 — 시험에서 명령만 확인한다).
 * 그림은 영상 크기에 맞춰 줄이고 남는 자리는 검게 채운다. 소리는 무음을 깐다.
 * 세 토막(인트로·본편·아웃트로)을 같은 규격으로 맞춘 뒤 이어 붙인다.
 */
export function buildBrandingArgs(p: {
  inPath: string; outPath: string; width: number; height: number;
  hasAudio: boolean; intro?: BrandClip | null; outro?: BrandClip | null; fps?: number;
  /** 본편 길이(초). 소리가 없는 본편에 까는 무음을 이 길이로 끊는다 — 없으면 끝나지 않는 입력이 된다 */
  mainDurationSec?: number;
}): BrandingPlan {
  if (!p.intro && !p.outro) throw new Error("붙일 인트로·아웃트로가 없습니다.");
  if (path.resolve(p.inPath) === path.resolve(p.outPath)) throw new Error("입력 파일 위에 덮어쓸 수 없습니다.");
  if (!(p.width > 0 && p.height > 0)) throw new Error("영상 크기를 알 수 없습니다.");
  const fps = p.fps ?? OUT_FPS;
  const W = p.width, H = p.height;
  const args: string[] = ["-hide_banner", "-loglevel", "error", "-i", p.inPath];
  let idx = 1;
  // 본편에 소리가 없으면 무음을 깔아 같은 그래프를 쓴다.
  // 무음은 반드시 본편 길이로 끊는다 — 끝없는 입력이 들어가면 concat 이 영원히 기다린다 (실제로 겪었다).
  let mainAudio = "[0:a]";
  if (!p.hasAudio) {
    if (!(p.mainDurationSec && p.mainDurationSec > 0)) throw new Error("소리 없는 영상에는 본편 길이가 필요합니다.");
    args.push("-f", "lavfi", "-t", p.mainDurationSec.toFixed(2), "-i", "anullsrc=r=44100:cl=stereo");
    mainAudio = `[${idx}:a]`; idx++;
  }

  const still = (clip: BrandClip, tag: string): { v: string; a: string } => {
    const sec = clampSec(clip.seconds).toFixed(1);
    args.push("-loop", "1", "-t", sec, "-i", clip.imagePath);
    const vi = idx++;
    args.push("-f", "lavfi", "-t", sec, "-i", "anullsrc=r=44100:cl=stereo");
    const ai = idx++;
    return {
      v: `[${vi}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[${tag}v]`,
      a: `[${ai}:a]aformat=sample_rates=44100:channel_layouts=stereo[${tag}a]`,
    };
  };

  const parts: string[] = [];
  const order: string[] = [];
  if (p.intro) { const s = still(p.intro, "i"); parts.push(s.v, s.a); order.push("[iv][ia]"); }
  parts.push(`[0:v]fps=${fps},setsar=1,format=yuv420p[mv]`);
  parts.push(`${mainAudio}aformat=sample_rates=44100:channel_layouts=stereo[ma]`);
  order.push("[mv][ma]");
  if (p.outro) { const s = still(p.outro, "o"); parts.push(s.v, s.a); order.push("[ov][oa]"); }
  parts.push(`${order.join("")}concat=n=${order.length}:v=1:a=1[v][a]`);

  args.push(
    "-filter_complex", parts.join(";"),
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
    "-movflags", "+faststart",
    "-y", p.outPath,
  );
  const introSec = p.intro ? clampSec(p.intro.seconds) : 0;
  const outroSec = p.outro ? clampSec(p.outro.seconds) : 0;
  return { args, introSec, outroSec, addedSec: Math.round((introSec + outroSec) * 10) / 10 };
}

/** 파일 내용의 첫 바이트로 그림 종류를 알아낸다 — 확장자는 믿지 않는다 */
export function sniffImage(buf: Buffer): "png" | "jpg" | "webp" | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/** 설정에 적힌 파일 이름 → 실제 그림 경로 (branding 폴더 안의 이름만 허용) */
export function resolveBrandImage(fileName: string): string | null {
  const leaf = path.basename(String(fileName ?? "").trim());
  if (!leaf || leaf === "." || leaf === "..") return null;
  const ext = path.extname(leaf).slice(1).toLowerCase();
  if (!BRANDING_EXTENSIONS.includes(ext)) return null;
  const abs = path.join(brandingDir(), leaf);
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

async function probeVideo(file: string): Promise<{ width: number; height: number; hasAudio: boolean; durationSec: number }> {
  const out = JSON.parse(await runFFprobe(["-v", "error", "-show_streams", "-show_format", "-of", "json", file])) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>; format?: { duration?: string };
  };
  const v = (out.streams ?? []).find((s) => s.codec_type === "video");
  if (!v || !v.width || !v.height) throw new Error("영상 크기를 알 수 없습니다.");
  return {
    width: v.width, height: v.height,
    hasAudio: (out.streams ?? []).some((s) => s.codec_type === "audio"),
    durationSec: parseFloat(out.format?.duration ?? "0") || 0,
  };
}

export interface BrandingOutcome {
  applied: boolean;
  /** 안 붙였다면 왜 */
  reason?: string;
  addedSec: number;
  /** 붙이기 전 원래 영상 (같은 폴더, 이름 뒤에 .raw) */
  rawPath?: string;
}

/**
 * 완성 영상에 인트로·아웃트로를 붙인다.
 *
 * 붙이기 전 파일은 같은 이름 뒤에 .raw 를 붙여 남기고, 붙인 결과가 원래 이름이 된다 —
 * 그래서 영상 경로를 쓰는 다른 코드(미리보기·발행)는 아무것도 바꿀 필요가 없다.
 * FFmpeg 가 실패하면 원래 파일을 제자리에 되돌린다. 영상이 사라지는 일은 없다.
 */
export async function applyBranding(videoPath: string, where: "reels" | "imported"): Promise<BrandingOutcome> {
  const b = getSettings().branding;
  const wanted = where === "reels" ? b.applyToReels : b.applyToImported;
  if (!wanted) return { applied: false, reason: "이 종류의 영상에는 붙이지 않도록 설정됨", addedSec: 0 };

  const introPath = b.intro.file ? resolveBrandImage(b.intro.file) : null;
  const outroPath = b.outro.file ? resolveBrandImage(b.outro.file) : null;
  if (b.intro.file && !introPath) logWarn("branding", `인트로 그림을 찾을 수 없습니다: ${b.intro.file}`);
  if (b.outro.file && !outroPath) logWarn("branding", `아웃트로 그림을 찾을 수 없습니다: ${b.outro.file}`);
  if (!introPath && !outroPath) return { applied: false, reason: "인트로·아웃트로 그림이 설정되지 않음", addedSec: 0 };

  const info = await probeVideo(videoPath);
  const ext = path.extname(videoPath);
  const rawPath = videoPath.slice(0, -ext.length) + ".raw" + ext;
  const tmpOut = videoPath.slice(0, -ext.length) + ".branding-tmp" + ext;
  const plan = buildBrandingArgs({
    inPath: videoPath, outPath: tmpOut, width: info.width, height: info.height, hasAudio: info.hasAudio,
    mainDurationSec: info.durationSec,
    intro: introPath ? { imagePath: introPath, seconds: b.intro.seconds } : null,
    outro: outroPath ? { imagePath: outroPath, seconds: b.outro.seconds } : null,
  });
  try {
    await runFFmpeg(plan.args, 30 * 60 * 1000);
  } catch (e) {
    try { fs.unlinkSync(tmpOut); } catch { /* 없으면 그만 */ }
    throw new Error(`인트로·아웃트로 붙이기 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  // 성공했을 때만 자리를 바꾼다: 원본 → .raw, 결과 → 원래 이름
  fs.renameSync(videoPath, rawPath);
  try {
    fs.renameSync(tmpOut, videoPath);
  } catch (e) {
    fs.renameSync(rawPath, videoPath); // 되돌린다 — 영상이 사라지면 안 된다
    throw e;
  }
  logInfo("branding", `인트로 ${plan.introSec}s · 아웃트로 ${plan.outroSec}s 붙임 — ${path.basename(videoPath)}`);
  return { applied: true, addedSec: plan.addedSec, rawPath };
}
