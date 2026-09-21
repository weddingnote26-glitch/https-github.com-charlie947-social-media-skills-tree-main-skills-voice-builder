import path from "node:path";
import fs from "node:fs";
import { runFFmpeg, runFFprobe } from "../ffmpeg";
import type { Scene } from "../schema";
import { DIRS } from "../paths";
import { getSettings } from "../settings";
import { logInfo } from "../log";
import type { CharacterPlacement } from "./character-overlay";

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
 * 장면에 끌어온 영상 클립(video_path)이 있으면 그 파일 경로를 모은다.
 * 경로만 있고 파일이 없으면 조용히 이미지로 넘어가지 않는다 — 사용자는 클립이
 * 들어간 영상을 기대하고 있으므로, 무엇이 왜 안 되는지 문장으로 멈춘다.
 */
export function sceneClipMap(scenes: Scene[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const s of scenes) {
    if (!s.video_path) continue;
    if (!fs.existsSync(s.video_path)) {
      throw new Error(
        `SCENE ${s.scene} 의 영상 클립 파일을 찾을 수 없습니다: ${s.video_path} — [② 장면 편집]에서 클립을 다시 넣거나 빼 주세요.`,
      );
    }
    m.set(s.scene, s.video_path);
  }
  return m;
}

/**
 * FFmpeg 인자 생성 — 테스트 가능하도록 실행과 분리 (§55).
 * imageBySene: scene 번호 → 이미지 경로
 */
export function buildRenderArgs(opts: {
  scenes: Scene[];
  imageByScene: Map<number, string>;
  /**
   * 클링AI 웹 등 밖에서 만들어 끌어온 장면 영상 (scene 번호 → 파일 경로).
   * 있는 장면은 이미지 + 카메라 움직임 대신 이 영상을 그대로 쓴다.
   * 자막·오락이·간판 합성은 이미지 장면과 똑같이 그 위에 얹힌다.
   */
  videoByScene?: Map<number, string>;
  /** null 이면 무음으로 만든다 — 음성 생성이 실패해도 영상은 나와야 한다 */
  voicePath: string | null;
  assPath: string;
  outPath: string;
  bgmPath?: string;
  bgmVolumeDb?: number;
  /**
   * 만두탐정 오락이를 영상에 직접 얹는다.
   * 이미지 AI 가 캐릭터를 빼먹거나 다른 얼굴로 그려도, 여기서 얹은 것은 반드시 나온다.
   */
  characters?: CharacterPlacement[];
}): RenderPlan {
  const { scenes } = opts;
  const totalSec = scenes[scenes.length - 1].end;
  const args: string[] = ["-hide_banner", "-loglevel", "error"];

  // 장면 입력들 — 클립이 있으면 클립, 없으면 이미지 (장면당 입력 하나라 뒤 인덱스 계산은 그대로다)
  for (const s of scenes) {
    const src = opts.videoByScene?.get(s.scene) ?? opts.imageByScene.get(s.scene);
    if (!src) throw new Error(`SCENE ${s.scene} 의 이미지·영상이 둘 다 없습니다`);
    args.push("-i", src);
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
  /* 캐릭터 그림도 입력으로 넣는다. 같은 파일을 여러 번 넣어도 PNG 한 장이라 부담이 적고,
     필터 안에서 출력을 나눠 쓰는 것보다 그래프가 단순해 실수가 적다. */
  const chars = opts.characters ?? [];
  const charStartIdx = (bgmIdx >= 0 ? bgmIdx : voiceIdx) + 1;
  for (const c of chars) args.push("-i", c.imagePath);

  // 장면별 영상 — 이미지는 Ken Burns, 끌어온 클립은 원래 움직임 그대로
  const parts: string[] = [];
  scenes.forEach((s, i) => {
    const dur = s.end - s.start;
    const frames = Math.max(1, Math.round(dur * FPS));
    const fadeIn = i > 0 ? `,fade=t=in:st=0:d=0.12` : "";
    const fadeOut = i === scenes.length - 1 ? `,fade=t=out:st=${Math.max(0, dur - 0.35).toFixed(2)}:d=0.35` : "";
    if (opts.videoByScene?.has(s.scene)) {
      /* 끌어온 영상 클립: 카메라 움직임(zoompan)을 얹지 않는다 — 클립의 움직임을 그대로 쓴다.
         길이는 장면 길이에 정확히 맞춘다:
         tpad 가 마지막 화면을 장면 길이만큼 무조건 이어 붙이고, trim 이 앞에서 장면 길이로 자른다.
         → 클립이 길면 앞부분만 쓰고, 짧으면 모자란 만큼 마지막 화면이 멈춘 채 채워진다.
         소리는 여기서 쓰지 않는다([i:v]만 뽑는다) — 나레이션·BGM 트랙이 소리를 맡는다.
         format=yuv420p 는 10비트 클립(HEVC 10bit 등)도 이미지 장면과 이어붙게 만든다. */
      parts.push(
        `[${i}:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},setsar=1,format=yuv420p,` +
        `tpad=stop_mode=clone:stop_duration=${dur.toFixed(2)},` +
        `trim=duration=${dur.toFixed(2)},setpts=PTS-STARTPTS${fadeIn}${fadeOut}[v${i}]`
      );
      return;
    }
    const motion = MOTION_EXPR[s.camera_motion](frames);
    parts.push(
      `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,` +
      `crop=${W * 2}:${H * 2},` +
      `zoompan=${motion}:d=${frames}:s=${W}x${H}:fps=${FPS},` +
      `setsar=1${fadeIn}${fadeOut}[v${i}]`
    );
  });
  const vLabels = scenes.map((_, i) => `[v${i}]`).join("");
  parts.push(`${vLabels}concat=n=${scenes.length}:v=1:a=0[vcat]`);

  /* 오락이 합성 — 자막보다 먼저 얹는다. 자막·간판이 캐릭터 위에 와야 글이 읽힌다.
     장면 시간에만 보이게 enable 로 켜고 끈다. */
  let stage = "vcat";
  chars.forEach((c, k) => {
    const inIdx = charStartIdx + k;
    const flip = c.flip ? ",hflip" : "";
    parts.push(`[${inIdx}:v]scale=-1:${c.height}:flags=lanczos${flip},format=rgba[ch${k}]`);
    const next = `cv${k}`;
    parts.push(
      `[${stage}][ch${k}]overlay=${c.x}:${c.y}:` +
      `enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[${next}]`
    );
    stage = next;
  });

  parts.push(
    `[${stage}]subtitles=filename='${escapeFilterPath(opts.assPath)}':fontsdir='${escapeFilterPath(DIRS.fonts)}',format=yuv420p[vout]`
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
