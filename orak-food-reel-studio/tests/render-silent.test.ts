import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("render-silent");
import fs from "node:fs";
import path from "node:path";
import { buildRenderArgs } from "../src/lib/pipeline/render";
import { runFFmpeg, runFFprobe, findFFmpeg } from "../src/lib/ffmpeg";
import type { Scene } from "../src/lib/schema";

/**
 * 실제로 겪은 일: ElevenLabs 402 하나로 릴스 전체가 실패해 MP4 가 아예 없었다.
 * 음성이 없어도 영상은 나와야 한다 — 말로만이 아니라 진짜 ffmpeg 로 확인한다.
 */
const TMP = path.join(process.cwd(), ".test-tmp", "render-silent");

function scene(n: number, start: number, end: number): Scene {
  return {
    scene: n, start, end, narration: "무음 시험", subtitle: "무음 시험",
    visual_prompt: "p", camera_motion: "static", character_action: null,
    character_expression: null, character_presence: "none", fact_source: "",
    image_path: null, image_hash: null,
  };
}

describe("음성 없이도 영상이 만들어진다", () => {
  it("voicePath=null 로도 재생 가능한 MP4 가 나온다 (진짜 ffmpeg)", async () => {
    if (!findFFmpeg()) {
      console.warn("ffmpeg 없음 — 이 환경에서는 건너뜁니다");
      return;
    }
    fs.mkdirSync(TMP, { recursive: true });
    // 시험용 이미지 두 장 (진짜 PNG)
    const img1 = path.join(TMP, "a.png"), img2 = path.join(TMP, "b.png");
    await runFFmpeg(["-f", "lavfi", "-i", "color=c=orange:s=540x960:d=1", "-frames:v", "1", "-y", img1]);
    await runFFmpeg(["-f", "lavfi", "-i", "color=c=teal:s=540x960:d=1", "-frames:v", "1", "-y", img2]);
    // 최소 자막 파일
    const ass = path.join(TMP, "s.ass");
    fs.writeFileSync(ass, "[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment\nStyle: D,Arial,48,&H00FFFFFF,1,2\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:02.00,D,무음 시험\n", "utf8");

    const out = path.join(TMP, "silent.mp4");
    const scenes = [scene(1, 0, 1.5), scene(2, 1.5, 3)];
    const plan = buildRenderArgs({
      scenes,
      imageByScene: new Map([[1, img1], [2, img2]]),
      voicePath: null,                       // ← 음성 실패 상황
      assPath: ass,
      outPath: out,
    });
    await runFFmpeg(plan.args, 120_000);

    // ffmpeg 가 끝났다는 이유만으로 성공 처리하지 않는다 — 파일을 검사한다
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(10_000);
    const probe = JSON.parse(await runFFprobe([
      "-v", "error", "-print_format", "json",
      "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", out,
    ])) as { streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }>; format: { duration: string } };
    const v = probe.streams.find((x) => x.codec_type === "video");
    const a = probe.streams.find((x) => x.codec_type === "audio");
    expect(v?.codec_name).toBe("h264");
    expect(v?.width).toBe(1080);
    expect(v?.height).toBe(1920);
    expect(a?.codec_name, "무음이어도 소리 트랙은 있어야 인스타그램이 받는다").toBe("aac");
    expect(Number(probe.format.duration)).toBeGreaterThan(2.5);
  }, 180_000);

  it("음성이 있으면 예전과 똑같이 그 파일을 쓴다", () => {
    const plan = buildRenderArgs({
      scenes: [scene(1, 0, 1.5)],
      imageByScene: new Map([[1, "/tmp/x.png"]]),
      voicePath: "/tmp/voice.mp3",
      assPath: "/tmp/s.ass",
      outPath: "/tmp/o.mp4",
    });
    expect(plan.args.join(" ")).toContain("/tmp/voice.mp3");
    expect(plan.args.join(" ")).not.toContain("anullsrc");
  });
});
