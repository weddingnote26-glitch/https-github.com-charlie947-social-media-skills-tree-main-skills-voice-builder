import path from "node:path";
import fs from "node:fs";
import { getReel, saveScenes, updateReel } from "../reels";
import { clearReview } from "../review";
import type { Scene } from "../schema";
import type { VideoInfo } from "./imported-video";

/**
 * 장면 영상 클립 — 클링AI 웹 등 밖에서 만든 영상을 장면에 끌어다 붙인다.
 *
 *  - 원본은 절대 건드리지 않는다: 릴스 폴더 아래 clips\ 에 복사본만 둔다.
 *  - 어떤 파일도 덮어쓰지 않는다: 저장 이름에 시각을 붙이고, 겹치면 번호를 더한다.
 *  - 클립을 빼도 파일은 지우지 않는다 — 기록(video_path)만 비운다.
 *  - 진짜 영상인지는 확장자가 아니라 FFprobe(inspectVideo)가 정한다.
 */

/** 업로드(끌어오기)로 받을 수 있는 최대 크기 — 요청 본문이 메모리에 한 번 담기므로 상한을 둔다 */
export const MAX_CLIP_BYTES = 300 * 1024 * 1024;

export function clipDir(outputDir: string): string {
  return path.join(outputDir, "clips");
}

/** 겹치지 않는 저장 경로 — 기존 파일을 절대 덮어쓰지 않는다. ext 는 ".mp4" 처럼 점 포함 */
export function uniqueClipPath(outputDir: string, sceneNo: number, ext: string): string {
  const dir = clipDir(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14); // yyyymmddhhmmss
  const name = (n: number) => `scene-${sceneNo}_${stamp}${n > 1 ? `-${n}` : ""}${ext.toLowerCase()}`;
  let p = path.join(dir, name(1));
  for (let n = 2; fs.existsSync(p); n++) p = path.join(dir, name(n));
  return p;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 클립이 장면에 어떻게 맞춰지는지 미리 사람 말로 알려 준다.
 * 렌더(render.ts)가 실제로 하는 일과 같은 규칙이어야 한다:
 * 화면은 9:16 을 채우도록 가운데를 잘라 쓰고, 길면 앞부분만, 짧으면 마지막 화면 정지로 채운다.
 */
export function clipNotes(info: VideoInfo, sceneSec: number): string[] {
  const notes: string[] = [];
  if (info.height > 0 && Math.abs(info.width / info.height - 9 / 16) > 0.02) {
    notes.push(
      info.width > info.height
        ? `가로 영상(${info.width}×${info.height})이라 세로 화면(9:16)을 채우도록 좌우가 크게 잘립니다 — 되도록 세로로 만들어 주세요.`
        : `9:16 비율이 아니어서(${info.width}×${info.height}) 화면을 채우도록 가장자리가 잘립니다.`,
    );
  }
  const secGap = round2(info.durationSec - sceneSec);
  if (secGap > 0.05) {
    notes.push(`클립(${info.durationSec}초)이 장면 길이(${sceneSec}초)보다 길어 앞 ${sceneSec}초만 씁니다 — 장면 길이를 늘리면 더 씁니다.`);
  } else if (secGap < -0.05) {
    notes.push(`클립(${info.durationSec}초)이 장면 길이(${sceneSec}초)보다 짧아 나머지 ${round2(-secGap)}초는 마지막 화면이 멈춘 채 채워집니다.`);
  }
  if (info.hasAudio) {
    notes.push("클립의 소리는 쓰지 않습니다 — 나레이션(AI 음성)과 배경음악이 소리를 맡습니다.");
  }
  return notes;
}

/**
 * 장면에 클립 경로를 기록한다 (null 이면 뺀다).
 * character_presence 때와 같은 함정을 피한다: DB(saveScenes)와 script_json 을
 * 함께 맞춰 두지 않으면 다음 읽기에서 클립이 사라진다.
 * 내용이 바뀌었으므로 상태는 검수로 돌리고, 발행 전 확인도 처음부터 다시 받는다.
 */
export function attachClip(reelId: string, sceneNo: number, videoPath: string | null): Scene {
  const reel = getReel(reelId);
  if (!reel) throw new Error("릴스를 찾을 수 없습니다");
  const scene = reel.scenes.find((s) => s.scene === sceneNo);
  if (!scene) throw new Error(`SCENE ${sceneNo} 를 찾을 수 없습니다`);
  scene.video_path = videoPath;
  saveScenes(reelId, reel.scenes);
  const patch: Record<string, unknown> = { status: "검수" };
  if (reel.script) {
    patch.script_json = JSON.stringify({ ...reel.script, scenes: reel.scenes });
  }
  updateReel(reelId, patch);
  clearReview(reelId);
  return scene;
}
