import path from "node:path";
import fs from "node:fs";
import { getTTS, audioDuration } from "../providers/tts";
import { runFFmpeg } from "../ffmpeg";
import type { Scene } from "../schema";
import { getSettings } from "../settings";
import { logInfo } from "../log";

/**
 * §16~17 장면별 음성 생성 → 실제 길이를 재서 장면 시간을 재조정 → 한 트랙으로 합침.
 * 결과: voice.mp3 + 실측 기준으로 갱신된 scenes.
 */
export async function generateVoice(
  scenes: Scene[],
  outDir: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ voicePath: string; scenes: Scene[]; totalSec: number }> {
  const tts = getTTS();
  const s = getSettings().tts;
  const segDir = path.join(outDir, "voice-segments");
  fs.mkdirSync(segDir, { recursive: true });

  const durations: number[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const seg = path.join(segDir, `seg-${String(i + 1).padStart(2, "0")}.mp3`);
    const buf = await tts.synthesize({
      text: scenes[i].narration,
      speed: s.speed, stability: s.stability, similarity: s.similarity,
      voiceId: s.voiceId || undefined, model: s.model || undefined,
    });
    fs.writeFileSync(seg, buf);
    durations.push(await audioDuration(seg));
    onProgress?.(i + 1, scenes.length);
  }

  // 장면 길이: 음성보다 짧아질 수는 없고, 계획보다 과하게 늘어지지도 않게
  // len = max(음성+0.25, min(계획, 음성+1.2)) → 전체 템포 유지 (§21)
  const adjusted: Scene[] = [];
  let t = 0;
  for (let i = 0; i < scenes.length; i++) {
    const planned = scenes[i].end - scenes[i].start;
    const len = Math.max(durations[i] + 0.25, Math.min(planned, durations[i] + 1.2));
    adjusted.push({ ...scenes[i], start: round1(t), end: round1(t + len) });
    t += len;
  }

  // 각 세그먼트를 장면 길이만큼 무음 패딩 후 이어붙임
  const paddedList: string[] = [];
  for (let i = 0; i < adjusted.length; i++) {
    const seg = path.join(segDir, `seg-${String(i + 1).padStart(2, "0")}.mp3`);
    const padded = path.join(segDir, `pad-${String(i + 1).padStart(2, "0")}.wav`);
    const len = adjusted[i].end - adjusted[i].start;
    await runFFmpeg([
      "-i", seg,
      "-af", `apad=whole_dur=${len.toFixed(2)}`,
      "-ar", "44100", "-ac", "2", "-y", padded,
    ]);
    paddedList.push(padded);
  }
  const listFile = path.join(segDir, "concat.txt");
  fs.writeFileSync(listFile, paddedList.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  const voicePath = path.join(outDir, "voice.mp3");
  await runFFmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-q:a", "3", "-y", voicePath]);

  const totalSec = round1(t);
  logInfo("tts", `음성 트랙 완성 — ${totalSec}s (${tts.name})`);
  return { voicePath, scenes: adjusted, totalSec };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
