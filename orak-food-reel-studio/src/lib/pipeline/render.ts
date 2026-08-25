import path from "node:path";
import fs from "node:fs";
import { runFFmpeg, runFFprobe } from "../ffmpeg";
import type { Scene } from "../schema";
import { DIRS } from "../paths";
import { getSettings } from "../settings";
import { logInfo } from "../log";

/**
 * §20~22 영상 제작 — 1080×1920 / 9:16 / MP4 / H.264 / AAC.
 * Ken Burns(zoom/pan) + 짧은 페이드 전환, ASS 자막 번인, 나레이션 + (선택) BGM 자동 더킹.
 */

export const FPS = 30;
export const W = 1080;
export const H = 1920;

const MOTION_EXPR: Record<Scene["camera_motion"], (frames: number) => string> = {
  slow_zoom_in: (d) => `z='1+0.09*on/${Math.max(1, d - 1)}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,
  slow_zoom_out: (d) => `z='1.10-0.09*on/${Math.max(1, d - 1)}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,
  pan_left: (d) => `z='1.10':x='(iw-iw/zoom)*(1-on/${Math.max(1, d - 1)})':y='(ih-ih/zoom)/2'`,
  pan_right: (d) => `z='1.10':x='(iw-iw/zoom)*on/${Math.max(1, d - 1)}':y='(ih-ih/zoom)/2'`,
  push_up: (d) => `z='1.10':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*(1-on/${Math.max(1, d - 1)})'`,
  push_down: (d) => `z='1.10':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*on/${Math.max(1, d - 1)}'`,
  static: () => `z='1.03':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,
};

/** 필터그래프 경로 이스케이프 (Windows 드라이브 콜론 포함) */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export interface RenderPlan {
  args: string[];
  totalSec: number;
}

/**
 * FFmpeg 인자 생성 — 테스트 가능하도록 실행과 분리 (§55).
 * imageBySene: scene 번호 → 이미지 경로
 */
export function buildRenderArgs(opts: {
  scenes: Scene[];
  imageByScene: Map<number, string>;
  /** null 이면 무음으로 만든다 — 음성 생성이 실패해도 영상은 나와야 한다 */
  voicePath: string | null;
  assPath: string;
  outPath: string;
  bgmPath?: string;
  bgmVolumeDb?: number;
}): RenderPlan {
  const { scenes } = opts;
  const totalSec = scenes[scenes.length - 1].end;
  const args: string[] = ["-hide_banner", "-loglevel", "error"];

  // 이미지 입력들
  for (const s of scenes) {
    const img = opts.imageByScene.get(s.scene);
    if (!img) throw new Error(`SCENE ${s.scene} 이미지가 없습니다`);
    args.push("-i", img);
  }
  const voiceIdx = scenes.length;
  if (opts.voicePath) {
    args.push("-i", opts.voicePath);
  } else {
    /* 음성 생성이 실패한 경우 — 조용한 소리 트랙을 깔아 같은 필터 그래프를 쓴다.
       길이는 아래 -t 가 못 박으므로 무한 입력이어도 안전하다.
       "음성이 없어서 영상 전체가 안 나오는" 일을 없애기 위한 길이다. */
    args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
  }
  let bgmIdx = -1;
  if (opts.bgmPath) {
    bgmIdx = voiceIdx + 1;
    args.push("-stream_loop", "-1", "-i", opts.bgmPath);
  }

  // 장면별 Ken Burns
  const parts: string[] = [];
  scenes.forEach((s, i) => {
    const dur = s.end - s.start;
    const frames = Math.max(1, Math.round(dur * FPS));
    const motion = MOTION_EXPR[s.camera_motion](frames);
    const fadeIn = i > 0 ? `,fade=t=in:st=0:d=0.12` : "";
    const fadeOut = i === scenes.length - 1 ? `,fade=t=out:st=${Math.max(0, dur - 0.35).toFixed(2)}:d=0.35` : "";
    parts.push(
      `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,` +
      `crop=${W * 2}:${H * 2},` +
      `zoompan=${motion}:d=${frames}:s=${W}x${H}:fps=${FPS},` +
      `setsar=1${fadeIn}${fadeOut}[v${i}]`
    );
  });
  const vLabels = scenes.map((_, i) => `[v${i}]`).join("");
  parts.push(`${vLabels}concat=n=${scenes.length}:v=1:a=0[vcat]`);
  parts.push(
    `[vcat]subtitles=filename='${escapeFilterPath(opts.assPath)}':fontsdir='${escapeFilterPath(DIRS.fonts)}',format=yuv420p[vout]`
  );

  // 오디오: 나레이션 + (선택) BGM 자동 더킹 (§22)
  if (bgmIdx >= 0) {
    const vol = opts.bgmVolumeDb ?? -22;
    parts.push(`[${voiceIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[voice][sc]`);
    parts.push(
      `[${bgmIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${totalSec.toFixed(2)},volume=${vol}dB[bgm]`
    );
    parts.push(`[bgm][sc]sidechaincompress=threshold=0.03:ratio=14:attack=25:release=450[duck]`);
    parts.push(`[voice][duck]amix=inputs=2:duration=first:normalize=0[aout]`);
  } else {
    parts.push(`[${voiceIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo[aout]`);
  }

  args.push(
    "-filter_complex", parts.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-profile:v", "high",
    "-r", String(FPS), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
    "-movflags", "+faststart",
    "-t", totalSec.toFixed(2),
    "-y", opts.outPath,
  );
  return { args, totalSec };
}

export async function renderReel(opts: Parameters<typeof buildRenderArgs>[0]): Promise<{ outPath: string; totalSec: number }> {
  const settings = getSettings();
  let bgmPath = opts.bgmPath;
  if (!bgmPath && settings.bgm.file) {
    const candidate = path.join(DIRS.bgm, settings.bgm.file);
    if (fs.existsSync(candidate)) bgmPath = candidate; // 사용자가 직접 등록한 음원만 (§22)
  }
  const plan = buildRenderArgs({ ...opts, bgmPath, bgmVolumeDb: settings.bgm.volumeDb });
  await runFFmpeg(plan.args, 20 * 60 * 1000);
  const dur = parseFloat((await runFFprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", opts.outPath])).trim());
  logInfo("render", `렌더 완료 — ${opts.outPath} (${dur.toFixed(1)}s)`);
  return { outPath: opts.outPath, totalSec: dur };
}
