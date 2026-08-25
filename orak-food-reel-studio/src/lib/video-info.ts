import fs from "node:fs";
import path from "node:path";
import { findFFprobe, runFFprobe } from "./ffmpeg";

/**
 * §5 미리보기 화면에 보여 줄 완성 영상의 실제 정보.
 *
 * 화면에 "괜찮아 보인다" 가 아니라 파일을 직접 읽어 확인한다.
 * ffprobe 가 없어도 화면이 멈추지 않도록, 알 수 없는 값은 null 로 둔다.
 */
export interface VideoInfo {
  exists: boolean;
  sizeBytes: number | null;
  sizeText: string;
  width: number | null;
  height: number | null;
  ratio: string;                 // 예: "9:16"
  durationSec: number | null;
  hasAudio: boolean | null;
  hasSubtitleFile: boolean;
  /** 인스타그램 릴스에 맞는 세로 영상인가 */
  verticalOk: boolean | null;
  notes: string[];
}

export function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** 가로:세로를 사람이 읽는 비율로 (1080×1920 → 9:16) */
export function ratioOf(w: number, h: number): string {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h) || 1;
  return `${w / d}:${h / d}`;
}

export async function videoInfo(videoPath: string | null, srtPath?: string | null): Promise<VideoInfo> {
  const notes: string[] = [];
  const hasSubtitleFile = !!srtPath && fs.existsSync(srtPath);

  if (!videoPath || !fs.existsSync(videoPath)) {
    return {
      exists: false, sizeBytes: null, sizeText: "-", width: null, height: null,
      ratio: "-", durationSec: null, hasAudio: null, hasSubtitleFile,
      verticalOk: null, notes: ["완성된 영상 파일이 아직 없습니다."],
    };
  }

  const sizeBytes = fs.statSync(videoPath).size;
  const base: VideoInfo = {
    exists: true, sizeBytes, sizeText: humanSize(sizeBytes),
    width: null, height: null, ratio: "-", durationSec: null,
    hasAudio: null, hasSubtitleFile, verticalOk: null, notes,
  };

  if (!findFFprobe()) {
    notes.push("FFprobe 를 찾지 못해 해상도·길이를 읽지 못했습니다. 파일 자체는 있습니다.");
    return base;
  }

  try {
    const out = await runFFprobe([
      "-v", "error", "-print_format", "json",
      "-show_entries", "stream=codec_type,width,height:format=duration",
      videoPath,
    ]);
    const parsed = JSON.parse(out) as {
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const streams = parsed.streams ?? [];
    const v = streams.find((s) => s.codec_type === "video");
    base.hasAudio = streams.some((s) => s.codec_type === "audio");
    base.width = v?.width ?? null;
    base.height = v?.height ?? null;
    if (base.width && base.height) {
      base.ratio = ratioOf(base.width, base.height);
      base.verticalOk = base.height > base.width;
      if (!base.verticalOk) notes.push("가로 영상입니다. 릴스는 세로(9:16)를 권합니다.");
    }
    const dur = Number(parsed.format?.duration);
    base.durationSec = Number.isFinite(dur) ? Math.round(dur * 10) / 10 : null;
    if (base.durationSec !== null && (base.durationSec < 3 || base.durationSec > 90)) {
      notes.push(`길이가 ${base.durationSec}초입니다. 릴스는 15~60초를 권합니다.`);
    }
    if (base.hasAudio === false) notes.push("소리가 없는 영상입니다. 음성을 다시 만들어 보세요.");
    if (!hasSubtitleFile) notes.push("자막 파일(.srt)이 없습니다.");
  } catch {
    notes.push("영상 정보를 읽는 중 문제가 있었습니다. 파일 자체는 있습니다.");
  }
  return base;
}

/** 화면 표시용 — 파일 이름만 (전체 경로에는 사용자 이름이 들어 있다) */
export function fileNameOf(p: string | null | undefined): string {
  return p ? path.basename(p) : "-";
}
