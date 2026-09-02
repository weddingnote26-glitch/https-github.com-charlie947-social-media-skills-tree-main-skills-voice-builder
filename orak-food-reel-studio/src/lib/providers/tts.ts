import path from "node:path";
import fs from "node:fs";
import { getEnv } from "../env";
import { resolveSecret, isSampleMode } from "../secrets";
import { getSettings } from "../settings";
import { ApiError, fetchBuffer, fetchJson, withRetry } from "./http";
import { describeKeyFailure } from "./api-failure";
import type { TTSProvider } from "./types";
import { runFFmpeg } from "../ffmpeg";
import { DIRS } from "../paths";
import { newId } from "../id";
import { checkVoiceId } from "./voice-id";

/** §16 ElevenLabs 기본 지원 */
class ElevenLabsTTS implements TTSProvider {
  readonly name = "elevenlabs";
  async synthesize(req: {
    text: string; voiceId?: string; model?: string;
    speed?: number; stability?: number; similarity?: number;
  }): Promise<Buffer> {
    const env = getEnv();
    const s = getSettings().tts;
    const voice = req.voiceId || s.voiceId || env.ELEVENLABS_VOICE_ID;
    // 잘못된 값이 주소에 실려 나가면 API 키가 오류 문구로 새어 나올 수 있다
    const check = checkVoiceId(voice);
    if (!check.ok) throw new Error(check.reason);
    return withRetry("elevenlabs", "tts", async () =>
      fetchBuffer("elevenlabs", `https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": resolveSecret("ELEVENLABS_API_KEY"),
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: req.text,
          model_id: req.model || s.model || env.ELEVENLABS_MODEL,
          voice_settings: {
            stability: req.stability ?? s.stability,
            similarity_boost: req.similarity ?? s.similarity,
            speed: req.speed ?? s.speed,
          },
        }),
      }), 3);
  }
}

/**
 * Sample Mode — 나레이션 길이에 맞는 저음량 톤 오디오 생성.
 * 실제 발화는 아니지만 영상 타이밍·렌더 흐름을 그대로 검증할 수 있음 (§50).
 */
class SampleTTS implements TTSProvider {
  readonly name = "sample";
  async synthesize(req: { text: string; speed?: number }): Promise<Buffer> {
    const chars = req.text.replace(/\s+/g, "").length;
    const speed = req.speed ?? getSettings().tts.speed ?? 1.05;
    // 한국어 낭독 대략 초당 5.6자(약간 빠른 소개 톤) 기준
    const dur = Math.max(0.8, chars / (5.6 * speed));
    const tmp = path.join(DIRS.audio, `${newId("sample")}.mp3`);
    fs.mkdirSync(DIRS.audio, { recursive: true });
    await runFFmpeg([
      "-f", "lavfi", "-i", `sine=frequency=340:duration=${dur.toFixed(2)}`,
      "-af", "volume=0.035,afade=t=in:d=0.05,afade=t=out:st=" + Math.max(0, dur - 0.1).toFixed(2) + ":d=0.1",
      "-c:a", "libmp3lame", "-q:a", "6", "-y", tmp,
    ]);
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    return buf;
  }
}

/**
 * 음성 생성 실패를 사용자가 다음에 할 일이 보이는 문장으로.
 * ElevenLabs 가 돌려주는 영어 JSON 을 그대로 화면에 남기면 무엇을 고쳐야 할지 알 수 없다.
 */
export function friendlyTtsError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const status = e instanceof ApiError ? e.status : (msg.match(/\b(40\d|429|5\d\d)\b/)?.[1] ?? "");
  if (status) return describeKeyFailure("elevenlabs", Number(status), msg);
  if (/목소리|voice/i.test(msg)) return msg.slice(0, 300);
  return msg.slice(0, 300);
}

export function getTTS(): TTSProvider {
  const env = getEnv();
  if (isSampleMode() || !resolveSecret("ELEVENLABS_API_KEY")) return new SampleTTS();
  return new ElevenLabsTTS();
}

/** 미리듣기용 — Sample Mode 여부와 상관없이 실제 ElevenLabs 음성을 씁니다 */
export function createElevenLabsTTS(): TTSProvider {
  return new ElevenLabsTTS();
}

export interface VoiceSummary {
  id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  previewUrl: string;
}

/** 계정에 등록된 목소리 목록 (§16 설정 화면에서 골라 쓰기 위함) */
export async function listElevenLabsVoices(): Promise<VoiceSummary[]> {
  const env = getEnv();
  if (!resolveSecret("ELEVENLABS_API_KEY")) throw new Error("ElevenLabs API 키가 없습니다. 설정 화면에서 넣어 주세요.");
  const out = await withRetry("elevenlabs", "list-voices", async () =>
    fetchJson<{ voices?: Array<{
      voice_id: string; name: string; category?: string;
      labels?: Record<string, string>; preview_url?: string;
    }> }>("elevenlabs", "https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: { "xi-api-key": resolveSecret("ELEVENLABS_API_KEY") },
    }), 2);
  return (out.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category ?? "",
    labels: v.labels ?? {},
    previewUrl: v.preview_url ?? "",
  }));
}

export interface TtsModelSummary {
  id: string;
  name: string;
  description: string;
  /** 지원 언어 코드 (예: ko) */
  languages: string[];
}

/**
 * 계정에서 쓸 수 있는 음성 모델 목록 (외부 영상 화면에서 골라 쓰기 위함).
 * 모델 이름을 코드에 박아 두면 ElevenLabs 가 이름을 바꿀 때마다 프로그램을 고쳐야 한다 —
 * 목소리 목록처럼 계정에서 받아온다. 글→음성이 되는 모델만 남긴다.
 */
export async function listElevenLabsModels(): Promise<TtsModelSummary[]> {
  if (!resolveSecret("ELEVENLABS_API_KEY")) throw new Error("ElevenLabs API 키가 없습니다. 설정 화면에서 넣어 주세요.");
  const out = await withRetry("elevenlabs", "list-models", async () =>
    fetchJson<Array<{
      model_id?: string; name?: string; description?: string;
      can_do_text_to_speech?: boolean;
      languages?: Array<{ language_id?: string; name?: string }>;
    }>>("elevenlabs", "https://api.elevenlabs.io/v1/models", {
      method: "GET",
      headers: { "xi-api-key": resolveSecret("ELEVENLABS_API_KEY") },
    }), 2);
  return (Array.isArray(out) ? out : [])
    .filter((m) => !!m.model_id && m.can_do_text_to_speech !== false)
    .map((m) => ({
      id: m.model_id as string,
      name: m.name ?? (m.model_id as string),
      description: m.description ?? "",
      languages: (m.languages ?? []).map((l) => l.language_id ?? "").filter(Boolean),
    }));
}

/** 오디오 길이(초) 측정 */
export async function audioDuration(file: string): Promise<number> {
  const { runFFprobe } = await import("../ffmpeg");
  const out = await runFFprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const n = parseFloat(out.trim());
  if (!Number.isFinite(n)) throw new Error(`오디오 길이 측정 실패: ${file}`);
  return n;
}
