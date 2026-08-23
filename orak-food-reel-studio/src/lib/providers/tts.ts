import path from "node:path";
import fs from "node:fs";
import { getEnv } from "../env";
import { getSettings } from "../settings";
import { fetchBuffer, fetchJson, withRetry } from "./http";
import type { TTSProvider } from "./types";
import { runFFmpeg } from "../ffmpeg";
import { DIRS } from "../paths";
import { newId } from "../id";

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
    if (!voice) throw new Error("ELEVENLABS_VOICE_ID가 설정되지 않았습니다");
    return withRetry("elevenlabs", "tts", async () =>
      fetchBuffer("elevenlabs", `https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": env.ELEVENLABS_API_KEY,
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

export function getTTS(): TTSProvider {
  const env = getEnv();
  if (env.APP_MODE === "sample" || !env.ELEVENLABS_API_KEY) return new SampleTTS();
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
  if (!env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY가 없습니다. .env에 키를 넣어 주세요.");
  const out = await withRetry("elevenlabs", "list-voices", async () =>
    fetchJson<{ voices?: Array<{
      voice_id: string; name: string; category?: string;
      labels?: Record<string, string>; preview_url?: string;
    }> }>("elevenlabs", "https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
    }), 2);
  return (out.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category ?? "",
    labels: v.labels ?? {},
    previewUrl: v.preview_url ?? "",
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
