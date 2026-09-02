import path from "node:path";
import fs from "node:fs";
import { db, j } from "../db";
import { newId, slugify, todayISO } from "../id";
import { DIRS } from "../paths";
import { runFFmpeg, runFFprobe } from "../ffmpeg";
import { getTTS, audioDuration, friendlyTtsError } from "../providers/tts";
import { getSettings } from "../settings";
import { logError, logInfo } from "../log";
import { redactError } from "../redact";
import { bugTag } from "../where";
import type { ProgressStep } from "./progress";
import { applyBranding } from "./branding";

/**
 * 외부에서 만든 영상에 AI 음성을 입혀 최종 MP4 를 만든다.
 *
 * 맛집 릴스 제작(run.ts)과는 다른 흐름이라 따로 둔다.
 *  - 대본·이미지·자막을 만들지 않는다. 사용자가 적은 나레이션 하나를 음성으로 만든다.
 *  - reels / production_jobs 를 쓰지 않는다 — 가짜 맛집·가짜 장면을 만들지 않으려고
 *    imported_video_jobs 표에 따로 기록한다.
 *  - 원본 영상은 읽기만 한다. 결과는 완성영상 폴더 아래 새 폴더에만 쓴다.
 *  - FFmpeg 가 0 으로 끝났다고 완료가 아니다. 결과 파일을 다시 열어 검증한 뒤에만 '완료'다.
 */

export const IMPORTED_STEP_DEFS = [
  { key: "probe", label: "원본 영상 확인" },
  { key: "voice", label: "AI 음성 생성" },
  { key: "render", label: "영상 합치기" },
  { key: "verify", label: "결과 검증" },
] as const;

export type ImportedStepKey = (typeof IMPORTED_STEP_DEFS)[number]["key"];
export type ImportedStep = ProgressStep & { key: ImportedStepKey };

/** 파일 고르기 창(electron/video-types.js)과 같은 목록이어야 한다 — 자동 테스트가 확인한다 */
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg", "wmv"];

export const FINAL_FILE_NAME = "최종_AI음성.mp4";

/** 음성 API 한 번에 보낼 최대 글자 수 — 너무 길면 거부된다. 문장 단위로 나눈다 */
export const NARRATION_CHUNK_CHARS = 1200;
export const NARRATION_MAX_CHARS = 8000;

/** "작게 섞기"의 기본 감쇠 */
export const DEFAULT_MIX_DB = -18;

/**
 * AI 음성 음량 기준.
 *
 * 실제로 겪은 일: 완성된 영상에 오디오 트랙은 붙었는데 최대 음량이 -49dB 라
 * 휴대폰에서 거의 들리지 않았다. 원인은 믹싱이 아니라 만들어진 음성 파일 자체가
 * 작았던 것이다 (연습 모드 샘플 톤은 일부러 작게 만들고, 모노를 스테레오로 바꾸며
 * 3dB 가 더 준다). 그래서 합치기 전에 한 번 재고, 모자란 만큼만 올린다.
 *
 *  - 평균을 목표까지 올리되, 피크가 한계에 닿으면 거기서 멈춘다 (클리핑 방지)
 *  - 절대 낮추지 않는다 (게인은 0dB 이상) — AI 음성을 작게 만드는 일은 없다
 *  - 아무리 작아도 상한까지만 올린다 — 잡음만 있는 파일을 크게 키우지 않는다
 */
export const TARGET_MEAN_DBFS = -20;
export const TARGET_PEAK_DBFS = -1.5;
export const MAX_GAIN_DB = 40;
/** 이보다 작으면 음성이 아니라 사실상 무음이다 — 올리지 않고 실패로 본다 */
export const SILENT_PEAK_DBFS = -60;
/** 최종 파일이 이보다 작으면 "들리지 않는 영상" 이므로 완료로 보지 않는다 */
export const FINAL_SILENT_PEAK_DBFS = -40;

export type AudioMode = "mute" | "mix";

export interface VideoInfo {
  name: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  pixFmt: string;
  hasAudio: boolean;
  audioCodec: string | null;
}

/** 이번 작업에만 쓰는 목소리 선택값 — 비운 항목은 설정 화면 값을 쓴다 */
export interface VoiceChoice {
  voiceId?: string;
  model?: string;
  speed?: number;
  stability?: number;
  similarity?: number;
}

/* ───────────────────────── 원본 확인 ───────────────────────── */

interface ProbeStream {
  codec_type?: string; codec_name?: string; width?: number; height?: number;
  pix_fmt?: string; duration?: string | number;
  disposition?: { attached_pic?: number };
}
interface ProbeOut {
  streams?: ProbeStream[];
  format?: { duration?: string | number; size?: string | number };
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

/** ffprobe JSON → 화면·검증에 쓰는 요약. 비디오 스트림이 없으면 영상이 아니다 */
export function parseProbeJson(text: string, name: string, sizeBytes: number): VideoInfo {
  let parsed: ProbeOut;
  try { parsed = JSON.parse(text) as ProbeOut; }
  catch { throw new Error("영상 정보를 읽지 못했습니다 — 파일이 손상됐거나 영상 파일이 아닙니다."); }
  const streams = parsed.streams ?? [];
  // 음악 파일의 표지 그림(attached_pic)도 "video" 로 나온다 — 그건 영상이 아니다
  const video = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  if (!video) throw new Error("이 파일에는 영상(비디오) 스트림이 없습니다. 확장자와 상관없이 실제 영상 파일만 쓸 수 있습니다.");
  const width = video.width ?? 0;
  const height = video.height ?? 0;
  if (!(width > 0 && height > 0)) throw new Error("영상 크기를 알 수 없습니다 — 파일이 손상됐을 수 있습니다.");
  const audio = streams.find((s) => s.codec_type === "audio");
  const dur = num(parsed.format?.duration) ?? num(video.duration) ?? 0;
  if (!(dur > 0)) throw new Error("영상 길이를 알 수 없습니다 — 파일이 손상됐을 수 있습니다.");
  return {
    name, sizeBytes,
    durationSec: round2(dur),
    width, height,
    videoCodec: video.codec_name ?? "",
    pixFmt: video.pix_fmt ?? "",
    hasAudio: !!audio,
    audioCodec: audio?.codec_name ?? null,
  };
}

/**
 * 화면이 보내온 경로를 쓰기 전에 거른다.
 * 전체 경로만 받고(어느 폴더 기준인지 짐작하지 않는다), 영상 확장자만 받는다.
 * 확장자는 첫 관문일 뿐이고, 실제 영상인지는 inspectVideo 가 FFprobe 로 확인한다.
 */
export function checkSourcePath(sourcePath: string): { ok: true; path: string } | { ok: false; reason: string } {
  // 윈도우 "경로로 복사" 는 따옴표를 붙인다 — 걷어낸다
  const p = String(sourcePath ?? "").trim().replace(/^"(.*)"$/, "$1").trim();
  if (!p) return { ok: false, reason: "영상 파일을 먼저 골라 주세요." };
  if (!path.isAbsolute(p)) {
    return { ok: false, reason: "영상 파일의 전체 경로가 필요합니다 (예: C:\\Users\\이름\\Videos\\영상.mp4). 탐색기에서 파일을 Shift+우클릭 → '경로로 복사' 하면 됩니다." };
  }
  const ext = path.extname(p).slice(1).toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      reason: `지원하지 않는 파일 형식입니다 (.${ext || "확장자 없음"}). 쓸 수 있는 형식: ${VIDEO_EXTENSIONS.map((e) => "." + e).join(" ")}`,
    };
  }
  return { ok: true, path: p };
}

/** 확장자만 믿지 않는다 — FFprobe 로 실제 비디오 스트림이 있는지 확인한다 */
export async function inspectVideo(sourcePath: string): Promise<VideoInfo> {
  const checked = checkSourcePath(sourcePath);
  if (!checked.ok) throw new Error(checked.reason);
  const p = checked.path;
  let st: fs.Stats;
  try { st = fs.statSync(p); }
  catch { throw new Error(`영상 파일을 찾을 수 없습니다: ${p}`); }
  if (st.isDirectory()) throw new Error("폴더가 아니라 영상 파일을 골라 주세요.");
  if (!st.isFile()) throw new Error("일반 파일이 아닙니다 — 영상 파일을 골라 주세요.");
  if (st.size === 0) throw new Error("빈 파일입니다 (0 바이트).");
  let out: string;
  try {
    out = await runFFprobe(["-v", "error", "-show_streams", "-show_format", "-of", "json", p]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ffprobe를 찾을 수 없습니다/.test(msg)) throw e;
    throw new Error("영상 파일로 읽히지 않습니다 — 파일이 손상됐거나 영상이 아닙니다.");
  }
  return parseProbeJson(out, path.basename(p), st.size);
}

/* ───────────────────────── 음량 재기 ───────────────────────── */

export interface VolumeLevels {
  /** 파일 전체의 평균 음량 (dBFS) */
  meanDb: number;
  /** 가장 큰 순간의 음량 (dBFS) */
  maxDb: number;
}

/** FFmpeg volumedetect 가 남긴 글에서 숫자만 뽑는다 (순수 함수 — 시험에서 직접 확인한다) */
export function parseVolumeDetect(log: string): VolumeLevels {
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(log)?.[1];
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(log)?.[1];
  if (mean === undefined || max === undefined) throw new Error("음량을 재지 못했습니다.");
  const levels = { meanDb: Number(mean), maxDb: Number(max) };
  if (!Number.isFinite(levels.meanDb) || !Number.isFinite(levels.maxDb)) throw new Error("음량을 재지 못했습니다.");
  return levels;
}

/**
 * 파일의 실제 음량을 잰다.
 * -v error 를 주면 volumedetect 가 남기는 결과까지 지워지므로 기본 기록 수준을 쓴다.
 */
export async function measureVolume(file: string): Promise<VolumeLevels> {
  const log = await runFFmpeg(["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], 10 * 60 * 1000);
  return parseVolumeDetect(log);
}

/**
 * 나레이션을 얼마나 키울지 (dB). 순수 함수 — 시험에서 숫자로 확인한다.
 * 평균을 목표까지 올리되 피크가 한계를 넘으면 거기서 멈추고, 0 아래로는 내려가지 않는다.
 */
export function narrationGainDb(levels: VolumeLevels): number {
  const raw = Math.min(TARGET_MEAN_DBFS - levels.meanDb, TARGET_PEAK_DBFS - levels.maxDb);
  const clamped = Math.min(MAX_GAIN_DB, Math.max(0, raw));
  return Math.round(clamped * 10) / 10;
}

/* ───────────────────────── 나레이션 → 음성 ───────────────────────── */

/**
 * 나레이션을 음성 API 한 번에 보낼 크기로 나눈다.
 * 문장을 자르지 않는다 — 빈 줄·문장 끝(. ! ? …)에서만 나누고, 한 문장이 상한보다 길 때만
 * 띄어쓰기에서 나눈다. 글자는 하나도 버리지 않는다.
 */
export function splitNarration(text: string, maxChars = NARRATION_CHUNK_CHARS): string[] {
  const clean = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  const sentences: string[] = [];
  for (const para of clean.split(/\n\s*\n/)) {
    const line = para.replace(/\s*\n\s*/g, " ").trim();
    if (!line) continue;
    // 문장 끝 기호 뒤의 공백에서 나눈다 (기호는 앞 문장에 남긴다)
    for (const s of line.split(/(?<=[.!?…。！？])\s+/)) {
      const t = s.trim();
      if (t) sentences.push(t);
    }
  }
  const chunks: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ""; };
  for (const s of sentences) {
    if (s.length > maxChars) {
      push();
      let rest = s;
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(" ", maxChars);
        if (cut <= 0) cut = maxChars;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      cur = rest;
      continue;
    }
    if (cur && cur.length + 1 + s.length > maxChars) push();
    cur = cur ? `${cur} ${s}` : s;
  }
  push();
  return chunks;
}

export interface NarrationResult {
  voicePath: string;
  totalSec: number;
  chunks: number;
  /** "elevenlabs" 또는 "sample"(연습 모드) */
  provider: string;
  /** 만들어진 음성 파일의 실제 음량 */
  levels: VolumeLevels;
  /** 합칠 때 올려야 할 양 (dB, 0 이상) */
  gainDb: number;
}

/**
 * 나레이션 → 음성 파일 하나(voice.wav).
 * 기존 음성 공급자(getTTS: ElevenLabs 또는 연습 모드 샘플 톤)를 그대로 쓴다.
 * 여기서 고른 목소리·모델·속도는 이번 호출에만 적용되고 전체 설정은 바꾸지 않는다.
 * 음성을 자르거나 줄이지 않는다.
 */
export async function synthesizeNarration(
  text: string,
  outDir: string,
  choice: VoiceChoice = {},
  onProgress?: (done: number, total: number) => void,
): Promise<NarrationResult> {
  const chunks = splitNarration(text);
  if (!chunks.length) throw new Error("나레이션이 비어 있습니다.");
  const tts = getTTS();
  const s = getSettings().tts;
  const segDir = path.join(outDir, "voice-segments");
  fs.mkdirSync(segDir, { recursive: true });

  const wavs: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const nn = String(i + 1).padStart(2, "0");
    const seg = path.join(segDir, `seg-${nn}.mp3`);
    let buf: Buffer;
    try {
      buf = await tts.synthesize({
        text: chunks[i],
        voiceId: choice.voiceId || s.voiceId || undefined,
        model: choice.model || s.model || undefined,
        speed: choice.speed ?? s.speed,
        stability: choice.stability ?? s.stability,
        similarity: choice.similarity ?? s.similarity,
      });
    } catch (e) {
      // 영어 원문 대신 무엇을 해야 하는지가 보이는 문장으로
      throw new Error(friendlyTtsError(e));
    }
    if (!buf || buf.length === 0) throw new Error("음성 API 가 빈 응답을 돌려줬습니다. 잠시 후 다시 시도해 주세요.");
    fs.writeFileSync(seg, buf);
    // 조각마다 같은 규격(44.1kHz 스테레오 WAV)으로 맞춰야 이어붙일 수 있다
    const wav = path.join(segDir, `seg-${nn}.wav`);
    await runFFmpeg(["-i", seg, "-ar", "44100", "-ac", "2", "-y", wav]);
    wavs.push(wav);
    onProgress?.(i + 1, chunks.length);
  }
  const listFile = path.join(segDir, "concat.txt");
  fs.writeFileSync(listFile, wavs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  const voicePath = path.join(outDir, "voice.wav");
  await runFFmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "pcm_s16le", "-y", voicePath]);
  const totalSec = round2(await audioDuration(voicePath));
  if (!(totalSec > 0)) throw new Error("만들어진 음성의 길이가 0 입니다.");
  // 소리가 실제로 들어 있는지, 그리고 얼마나 키워야 하는지를 여기서 정한다
  const levels = await measureVolume(voicePath);
  if (levels.maxDb < SILENT_PEAK_DBFS) {
    throw new Error(`만들어진 음성이 사실상 무음입니다 (최대 ${levels.maxDb}dB). 목소리 설정을 확인하고 다시 시도해 주세요.`);
  }
  const gainDb = narrationGainDb(levels);
  logInfo("imported", `나레이션 음성 완성 — ${totalSec}s, ${chunks.length}조각 (${tts.name}) · 평균 ${levels.meanDb}dB · 최대 ${levels.maxDb}dB → +${gainDb}dB`);
  return { voicePath, totalSec, chunks: chunks.length, provider: tts.name, levels, gainDb };
}

/* ───────────────────────── 합치기 ───────────────────────── */

export interface RenderPlan {
  args: string[];
  /** 최종 길이(초). 음성이 더 길면 마지막 장면을 멈춘 채 그만큼 늘어난다 */
  finalSec: number;
  /** 음성 때문에 늘어난 길이(초) */
  extendedSec: number;
  /** 기존 소리를 실제로 섞었는지 (원본에 소리가 없으면 섞을 수 없다) */
  mixed: boolean;
  /** AI 음성에 실제로 올린 양 (dB) */
  voiceGainDb: number;
}

/** AI 음성 게인 — 올리기만 하고, 상한을 넘지 않는다 */
function clampGain(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.round(Math.min(MAX_GAIN_DB, Math.max(0, v)) * 10) / 10;
}

function clampDb(v: number | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_MIX_DB;
  return Math.min(0, Math.max(-40, Math.round(n)));
}

/**
 * FFmpeg 명령을 만든다 (순수 함수 — 테스트에서 명령만 확인한다).
 *
 *  - 영상은 H.264 / yuv420p, 소리는 AAC 192k, +faststart (휴대폰·인스타그램 규격)
 *  - 음성을 자르지 않는다: 영상보다 길면 마지막 프레임을 그만큼 더 보여준다(tpad)
 *  - mute: 원본 소리를 버리고 AI 음성만 / mix: 원본 소리를 낮춰 AI 음성과 섞는다
 *  - 원본 위에 덮어쓰는 명령은 만들지 않는다
 */
export function buildImportedRenderArgs(p: {
  sourcePath: string; voicePath: string; outPath: string;
  videoSec: number; voiceSec: number; hasAudio: boolean;
  audioMode: AudioMode; mixDb?: number;
  /** AI 음성을 키울 양 (dB). 음수는 무시한다 — AI 음성을 작게 만들지 않는다 */
  voiceGainDb?: number;
}): RenderPlan {
  if (path.resolve(p.outPath) === path.resolve(p.sourcePath)) {
    throw new Error("원본 영상 위에 덮어쓸 수 없습니다 — 결과는 새 파일로만 저장합니다.");
  }
  if (!(p.videoSec > 0)) throw new Error("영상 길이를 알 수 없습니다.");
  if (!(p.voiceSec > 0)) throw new Error("음성 길이를 알 수 없습니다.");

  const extendedSec = Math.max(0, ceil2(p.voiceSec - p.videoSec));
  const finalSec = round2(p.videoSec + extendedSec);

  // yuv420p 는 가로·세로가 짝수여야 한다
  const vf = ["scale=trunc(iw/2)*2:trunc(ih/2)*2"];
  if (extendedSec > 0) vf.push(`tpad=stop_mode=clone:stop_duration=${extendedSec}`);

  const mixed = p.audioMode === "mix" && p.hasAudio;
  // AI 음성은 올리기만 한다 (0dB 미만은 쓰지 않는다). 0 이면 필터를 아예 넣지 않는다.
  const voiceGainDb = clampGain(p.voiceGainDb);
  const nar = voiceGainDb > 0 ? `volume=${voiceGainDb}dB,apad` : "apad";
  const audio = mixed
    // 섞을 때는 두 소리를 그대로 더하므로(normalize=0) 합이 0dBFS 를 넘을 수 있다.
    // alimiter 로 끝에서만 눌러 준다 — level=false 라야 조용한 구간을 제멋대로 키우지 않는다.
    ? `[0:a]volume=${clampDb(p.mixDb)}dB,apad[bg];[1:a]${nar}[nar];` +
      `[bg][nar]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[sum];` +
      `[sum]alimiter=limit=0.98:level=false[a]`
    : `[1:a]${nar}[a]`;

  const args = [
    "-i", p.sourcePath, "-i", p.voicePath,
    "-filter_complex", `[0:v]${vf.join(",")}[v];${audio}`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
    "-movflags", "+faststart",
    // apad 로 무한히 늘어난 소리는 여기서 끊는다 — 영상·음성 중 긴 쪽 길이까지
    "-t", finalSec.toFixed(2),
    "-y", p.outPath,
  ];
  return { args, finalSec, extendedSec, mixed, voiceGainDb };
}

/* ───────────────────────── 결과 검증 ───────────────────────── */

export interface VerifyResult {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  pixFmt: string;
  faststart: boolean;
  sizeBytes: number;
  /** 최종 파일에서 실제로 잰 음량 — "트랙이 있다" 와 "들린다" 는 다르다 */
  levels: VolumeLevels;
  /** 통과한 항목을 사람 말로 */
  checks: string[];
}

const TOLERANCE_SEC = 0.35;

/**
 * MP4 상자(box)를 앞에서부터 머리만 읽어 moov 가 mdat 보다 앞에 있는지 본다 (faststart).
 * 앞에 있어야 휴대폰·인스타그램이 파일을 다 받기 전에 재생을 시작할 수 있다.
 * 읽기 함수만 받는 순수 함수라 테스트에서 만든 바이트로도 확인할 수 있다.
 */
export function scanTopLevelBoxes(read: (pos: number, len: number) => Buffer, fileSize: number): boolean {
  let pos = 0;
  for (let i = 0; i < 64 && pos + 8 <= fileSize; i++) {
    const head = read(pos, 16);
    if (head.length < 8) return false;
    let boxSize = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    if (boxSize === 1) {
      if (head.length < 16) return false;
      boxSize = Number(head.readBigUInt64BE(8)); // 64비트 크기
    } else if (boxSize === 0) {
      boxSize = fileSize - pos; // 파일 끝까지
    }
    if (type === "moov") return true;
    if (type === "mdat") return false;
    if (boxSize < 8) return false;
    pos += boxSize;
  }
  return false;
}

/** 큰 파일을 통째로 읽지 않고 상자 머리만 읽는다 */
export function moovBeforeMdat(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    return scanTopLevelBoxes((pos, len) => {
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, pos);
      return buf.subarray(0, n);
    }, size);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * FFmpeg 가 0 으로 끝났다고 완료가 아니다. 결과 파일을 다시 열어 확인한다:
 *  ① 파일이 있고 비어 있지 않다  ② 비디오 스트림 H.264 / yuv420p  ③ 오디오 스트림 AAC
 *  ④ 길이가 음성보다 짧지 않다(음성이 잘리지 않았다)  ⑤ 원본보다 짧지 않다
 *  ⑥ faststart (moov 가 앞)  ⑦ 처음부터 끝까지 디코딩해도 오류가 없다
 */
export async function verifyFinalVideo(
  finalPath: string,
  expected: { voiceSec: number; videoSec: number },
): Promise<VerifyResult> {
  const bad = (why: string) => new Error(`결과 검증 실패 — ${why}`);
  const checks: string[] = [];

  let st: fs.Stats | null = null;
  try { st = fs.statSync(finalPath); } catch { st = null; }
  if (!st || !st.isFile()) throw bad("최종 파일이 만들어지지 않았습니다");
  if (st.size < 1024) throw bad(`최종 파일이 비어 있습니다 (${st.size} 바이트)`);
  checks.push(`파일 ${(st.size / 1024 / 1024).toFixed(1)}MB`);

  let probeText: string;
  try {
    probeText = await runFFprobe(["-v", "error", "-show_streams", "-show_format", "-of", "json", finalPath]);
  } catch (e) {
    throw bad(`결과 파일을 열 수 없습니다: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  let info: VideoInfo;
  try { info = parseProbeJson(probeText, path.basename(finalPath), st.size); }
  catch (e) { throw bad(e instanceof Error ? e.message : String(e)); }
  const audio = ((JSON.parse(probeText) as ProbeOut).streams ?? []).find((s) => s.codec_type === "audio");
  if (!audio) throw bad("오디오 스트림이 없습니다 — AI 음성이 들어가지 않았습니다");
  if (info.videoCodec !== "h264") throw bad(`비디오 코덱이 H.264 가 아닙니다 (${info.videoCodec || "알 수 없음"})`);
  if ((audio.codec_name ?? "") !== "aac") throw bad(`오디오 코덱이 AAC 가 아닙니다 (${audio.codec_name || "알 수 없음"})`);
  if (info.pixFmt !== "yuv420p") throw bad(`픽셀 형식이 yuv420p 가 아닙니다 (${info.pixFmt || "알 수 없음"}) — 휴대폰에서 재생이 안 될 수 있습니다`);
  checks.push(`H.264/AAC/yuv420p ${info.width}x${info.height}`);

  if (info.durationSec < expected.voiceSec - TOLERANCE_SEC) {
    throw bad(`결과(${info.durationSec}s)가 음성(${expected.voiceSec}s)보다 짧습니다 — 음성이 잘렸습니다`);
  }
  if (info.durationSec < expected.videoSec - TOLERANCE_SEC) {
    throw bad(`결과(${info.durationSec}s)가 원본 영상(${expected.videoSec}s)보다 짧습니다`);
  }
  checks.push(`길이 ${info.durationSec}s (음성 ${expected.voiceSec}s · 원본 ${expected.videoSec}s)`);

  const faststart = moovBeforeMdat(finalPath);
  if (!faststart) throw bad("faststart 가 적용되지 않았습니다 (moov 상자가 파일 뒤에 있음)");
  checks.push("faststart");

  /*
   * 오디오 스트림이 있다고 들리는 것은 아니다.
   * 실제로 트랙은 붙었는데 최대 -49dB 라 휴대폰에서 거의 안 들리는 파일을 완료로 처리한 적이 있다.
   * 그래서 여기서 실제 음량을 재고, 사실상 무음이면 완료로 보지 않는다.
   */
  let levels: VolumeLevels;
  try { levels = await measureVolume(finalPath); }
  catch (e) { throw bad(`음량을 재지 못했습니다: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`); }
  if (levels.maxDb < FINAL_SILENT_PEAK_DBFS) {
    throw bad(`소리가 사실상 들리지 않습니다 (최대 ${levels.maxDb}dB · 평균 ${levels.meanDb}dB). AI 음성이 너무 작게 합쳐졌습니다`);
  }
  checks.push(`음량 최대 ${levels.maxDb}dB · 평균 ${levels.meanDb}dB`);

  // 끝까지 디코딩 — 중간에 깨진 구간이 있으면 여기서 걸린다 (-xerror: 오류가 나면 바로 실패)
  let decodeLog = "";
  try {
    decodeLog = await runFFmpeg(["-v", "error", "-xerror", "-i", finalPath, "-f", "null", "-"], 30 * 60 * 1000);
  } catch (e) {
    throw bad(`디코딩 중 오류: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  if (decodeLog.trim()) throw bad(`디코딩 경고: ${decodeLog.trim().slice(0, 200)}`);
  checks.push("전체 디코딩 통과");

  return {
    durationSec: info.durationSec, width: info.width, height: info.height,
    videoCodec: info.videoCodec, audioCodec: audio.codec_name ?? "", pixFmt: info.pixFmt,
    faststart, sizeBytes: st.size, levels, checks,
  };
}

/* ───────────────────────── 저장 폴더 ───────────────────────── */

/** 완성영상 폴더 아래 새 작업 폴더 — 같은 이름이 있으면 번호를 붙인다 (덮어쓰지 않는다) */
export function importedOutputDir(sourceName: string, date = todayISO()): string {
  const base = path.basename(sourceName, path.extname(sourceName));
  const stem = `${date}_외부영상_${slugify(base)}`;
  fs.mkdirSync(DIRS.output, { recursive: true });
  let dir = path.join(DIRS.output, stem);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(DIRS.output, `${stem}-${n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMeta(outDir: string, patch: Record<string, unknown>): void {
  const file = path.join(outDir, "metadata.json");
  let cur: Record<string, unknown> = {};
  try { cur = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* 처음 */ }
  fs.writeFileSync(file, JSON.stringify({ ...cur, ...patch }, null, 2), "utf8");
}

/* ───────────────────────── 작업 기록 (imported_video_jobs) ───────────────────────── */

export interface ImportedJobRow {
  id: string;
  title: string;
  source_path: string;
  source_info: VideoInfo | null;
  narration: string;
  voice: VoiceChoice;
  audio_mode: AudioMode;
  mix_db: number;
  output_dir: string | null;
  voice_path: string | null;
  final_path: string | null;
  duration_sec: number | null;
  steps: ImportedStep[];
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportedJobInput {
  sourcePath: string;
  title?: string;
  narration: string;
  voice: VoiceChoice;
  audioMode: AudioMode;
  mixDb?: number;
}

function initSteps(): ImportedStep[] {
  return IMPORTED_STEP_DEFS.map((s) => ({ key: s.key, label: s.label, status: "대기중" as const, progress: 0 }));
}

function toRow(r: Record<string, unknown>): ImportedJobRow {
  const info = j<Partial<VideoInfo>>(r.source_info_json as string, {});
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    source_path: String(r.source_path ?? ""),
    source_info: info.durationSec ? (info as VideoInfo) : null,
    narration: String(r.narration ?? ""),
    voice: j<VoiceChoice>(r.voice_json as string, {}),
    audio_mode: r.audio_mode === "mix" ? "mix" : "mute",
    mix_db: typeof r.mix_db === "number" ? r.mix_db : DEFAULT_MIX_DB,
    output_dir: text(r.output_dir),
    voice_path: text(r.voice_path),
    final_path: text(r.final_path),
    duration_sec: typeof r.duration_sec === "number" ? r.duration_sec : null,
    steps: j<ImportedStep[]>(r.steps_json as string, []),
    status: String(r.status ?? ""),
    error: text(r.error),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

/** 진행 중에 채워지는 열만 — SQL 에 열 이름을 끼워 넣으므로 목록 밖의 이름은 버린다 */
const PROGRESS_COLUMNS = new Set(["source_info_json", "output_dir", "voice_path", "final_path", "duration_sec", "error"]);

function saveJob(jobId: string, steps: ImportedStep[], status: string, extra: Record<string, unknown> = {}): void {
  const sets = ["steps_json=?", "status=?", "updated_at=datetime('now')"];
  const vals: unknown[] = [JSON.stringify(steps), status];
  for (const [k, v] of Object.entries(extra)) {
    if (!PROGRESS_COLUMNS.has(k)) continue;
    sets.push(`${k}=?`);
    vals.push(v);
  }
  vals.push(jobId);
  db().prepare(`UPDATE imported_video_jobs SET ${sets.join(", ")} WHERE id=?`).run(...vals);
}

export function createImportedJob(input: ImportedJobInput, info: VideoInfo): string {
  const id = newId("imp");
  const title = (input.title ?? "").trim() || path.basename(info.name, path.extname(info.name));
  db().prepare(
    `INSERT INTO imported_video_jobs (id, title, source_path, source_info_json, narration, voice_json, audio_mode, mix_db, steps_json, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, title.slice(0, 80), input.sourcePath, JSON.stringify(info), input.narration,
    JSON.stringify(input.voice ?? {}), input.audioMode === "mix" ? "mix" : "mute",
    clampDb(input.mixDb), JSON.stringify(initSteps()), "진행중",
  );
  return id;
}

export function getImportedJob(id: string): ImportedJobRow | null {
  const row = db().prepare("SELECT * FROM imported_video_jobs WHERE id=?").get(id);
  return row ? toRow(row) : null;
}

export function listImportedJobs(status?: string, limit = 50): ImportedJobRow[] {
  const rows = status
    ? db().prepare("SELECT * FROM imported_video_jobs WHERE status=? ORDER BY created_at DESC LIMIT ?").all(status, limit)
    : db().prepare("SELECT * FROM imported_video_jobs ORDER BY created_at DESC LIMIT ?").all(limit);
  return rows.map(toRow);
}

export function countImportedJobs(status: string): number {
  const row = db().prepare("SELECT COUNT(*) AS c FROM imported_video_jobs WHERE status=?").get(status) as { c: number };
  return row.c;
}

/** 작업 기록만 지운다 — 만들어진 영상 파일은 건드리지 않고, 돌고 있는 작업도 지우지 않는다 */
export function deleteImportedJobs(ids: string[]): number {
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x.trim()))];
  if (unique.length === 0) return 0;
  const stmt = db().prepare("DELETE FROM imported_video_jobs WHERE id=? AND status<>'진행중'");
  let removed = 0;
  for (const id of unique) removed += stmt.run(id).changes;
  return removed;
}

/**
 * 서버가 꺼지면 돌던 외부 영상 작업도 그 자리에서 죽는다. DB 에 "진행중"으로 남으면
 * 제작중 화면에 영원히 도는 유령 작업처럼 보인다 — 기동 때 한 번 정리한다
 * (production_jobs 와 같은 규칙, instrumentation.ts 가 부른다). 돌려주는 값은 정리한 개수.
 */
export function cleanupStaleImportedJobs(): number {
  const stale = db().prepare("SELECT COUNT(*) AS c FROM imported_video_jobs WHERE status='진행중'").get() as { c: number };
  if (stale.c > 0) {
    db().prepare(
      `UPDATE imported_video_jobs
         SET status='실패',
             error=COALESCE(NULLIF(error,''), '서버가 다시 시작되어 중단되었습니다. 다시 만들기를 눌러 주세요.'),
             updated_at=datetime('now')
       WHERE status='진행중'`,
    ).run();
  }
  return stale.c;
}

/* ───────────────────────── 실행 ───────────────────────── */

/** 실행 중 작업 — 같은 작업이 두 번 돌지 않게 */
const running = new Set<string>();

/** 작업을 만들고 바로 시작한다 — jobId 를 즉시 돌려주고 실제 작업은 뒤에서 돈다 */
export function startImportedJob(input: ImportedJobInput, info: VideoInfo): { jobId: string } {
  const jobId = createImportedJob(input, info);
  void runImportedJob(jobId).catch((e) => {
    logError("imported", `작업 실패: ${redactError(e)}`);
  });
  return { jobId };
}

function describeInfo(info: VideoInfo): string {
  return `${info.width}x${info.height} · ${info.durationSec}s · ${info.hasAudio ? "소리 있음" : "소리 없음"}`;
}

export async function runImportedJob(jobId: string): Promise<void> {
  const row = getImportedJob(jobId);
  if (!row) throw new Error("작업을 찾을 수 없습니다");
  if (running.has(jobId)) throw new Error("이 작업은 이미 진행 중입니다.");
  running.add(jobId);

  const steps = initSteps();
  const mark = (key: ImportedStepKey, patch: Partial<ImportedStep>, status = "진행중", extra: Record<string, unknown> = {}) => {
    Object.assign(steps.find((s) => s.key === key)!, patch);
    saveJob(jobId, steps, status, extra);
  };

  try {
    // 1) 원본 확인 — 고를 때 확인했더라도 지금 다시 확인한다 (그사이 옮겨졌을 수 있다)
    mark("probe", { status: "진행중", progress: 0, indeterminate: true });
    const info = await inspectVideo(row.source_path);
    const outDir = importedOutputDir(info.name);
    fs.writeFileSync(path.join(outDir, "narration.txt"), row.narration, "utf8");
    writeMeta(outDir, {
      kind: "imported-video", job_id: jobId, title: row.title, source_path: row.source_path,
      source: info, voice: row.voice, audio_mode: row.audio_mode, mix_db: row.mix_db,
      started_at: new Date().toISOString(),
    });
    mark("probe", { status: "완료", progress: 100, indeterminate: false, message: describeInfo(info) },
      "진행중", { source_info_json: JSON.stringify(info), output_dir: outDir });

    // 2) AI 음성 — 고른 목소리·모델·속도는 이 작업에만 쓴다
    mark("voice", { status: "진행중", progress: 0, indeterminate: false, message: "AI 음성을 만드는 중" });
    const voice = await synthesizeNarration(row.narration, outDir, row.voice, (done, total) => {
      mark("voice", { progress: Math.round((done / total) * 100), message: `${done}/${total} 조각` });
    });
    mark("voice", {
      status: "완료", progress: 100, indeterminate: false,
      message: `${voice.totalSec}s (${voice.provider === "sample" ? "연습 모드 — 샘플 톤" : "ElevenLabs"})`
        + (voice.gainDb > 0 ? ` · 음량 ${voice.levels.maxDb}dB → +${voice.gainDb}dB 올림` : " · 음량 그대로"),
    }, "진행중", { voice_path: voice.voicePath });

    // 3) 합치기
    mark("render", { status: "진행중", progress: 0, indeterminate: true, message: "FFmpeg 로 합치는 중" });
    const finalPath = path.join(outDir, FINAL_FILE_NAME);
    const plan = buildImportedRenderArgs({
      sourcePath: row.source_path, voicePath: voice.voicePath, outPath: finalPath,
      videoSec: info.durationSec, voiceSec: voice.totalSec, hasAudio: info.hasAudio,
      audioMode: row.audio_mode, mixDb: row.mix_db, voiceGainDb: voice.gainDb,
    });
    await runFFmpeg(plan.args, 60 * 60 * 1000);
    // 인트로·아웃트로 — 설정돼 있을 때만. 실패해도 합친 영상은 그대로 둔다.
    let brandNote = "";
    let brandSec = 0;
    try {
      const brand = await applyBranding(finalPath, "imported");
      if (brand.applied) { brandSec = brand.addedSec; brandNote = `인트로·아웃트로 +${brand.addedSec}s`; }
    } catch (e) {
      logError("imported", `인트로·아웃트로를 붙이지 못해 그대로 둡니다: ${redactError(e)}`);
      brandNote = "인트로·아웃트로는 붙이지 못했습니다 (영상은 그대로)";
    }
    const renderNote = [
      brandNote,
      plan.extendedSec > 0 ? `음성이 영상보다 ${plan.extendedSec}s 길어 마지막 장면을 멈춘 채 이어 붙였습니다` : "",
      row.audio_mode === "mix" && !plan.mixed ? "원본에 소리가 없어 AI 음성만 넣었습니다" : "",
      plan.mixed ? `기존 소리를 ${clampDb(row.mix_db)}dB 로 낮춰 섞었습니다` : "",
    ].filter(Boolean).join(" · ");
    writeMeta(outDir, {
      voice: { sec: voice.totalSec, chunks: voice.chunks, provider: voice.provider, levels: voice.levels, gain_db: voice.gainDb },
      render: { final_sec: plan.finalSec + brandSec, extended_sec: plan.extendedSec, mixed: plan.mixed, voice_gain_db: plan.voiceGainDb, branding_sec: brandSec },
    });
    mark("render", { status: "완료", progress: 100, indeterminate: false, message: renderNote || `${plan.finalSec}s` });

    // 4) 검증 — 여기까지 통과해야 완료다
    mark("verify", { status: "진행중", progress: 0, indeterminate: true, message: "결과 파일을 다시 열어 확인하는 중" });
    const verified = await verifyFinalVideo(finalPath, { voiceSec: voice.totalSec, videoSec: info.durationSec });
    writeMeta(outDir, { final_path: finalPath, verified, finished_at: new Date().toISOString() });
    mark("verify", { status: "완료", progress: 100, indeterminate: false, message: verified.checks.join(" · ") },
      "완료", { final_path: finalPath, duration_sec: verified.durationSec });
    logInfo("imported", `외부 영상 최종 제작 완료 — ${finalPath}`);
  } catch (e) {
    // 외부 오류 문구는 우리가 만든 게 아니다 — 화면·DB에 남기기 전에 비밀값을 지운다
    const msg = redactError(e) + bugTag(e);
    const failing = steps.find((s) => s.status === "진행중");
    logError("imported", `${failing?.label ?? "제작"} 단계 실패 — ${msg}`, {
      step: failing?.key,
      kind: e instanceof Error ? e.name : typeof e,
      stack: e instanceof Error && e.stack ? e.stack.split("\n").slice(0, 8).join(" | ") : undefined,
    });
    if (failing) Object.assign(failing, { status: "실패", message: msg.slice(0, 300) });
    saveJob(jobId, steps, "실패", { error: msg.slice(0, 500) });
    throw e;
  } finally {
    running.delete(jobId);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ceil2(n: number): number {
  return Math.ceil(n * 100 - 1e-6) / 100;
}
