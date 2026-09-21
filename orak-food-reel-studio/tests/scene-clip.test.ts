import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("scene-clip");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRenderArgs, sceneClipMap } from "../src/lib/pipeline/render";
import { uniqueClipPath, clipNotes, attachClip, MAX_CLIP_BYTES } from "../src/lib/pipeline/scene-clip";
import type { VideoInfo } from "../src/lib/pipeline/imported-video";
import { saveScenes, getReel } from "../src/lib/reels";
import { db } from "../src/lib/db";
import { SceneSchema, type Scene } from "../src/lib/schema";

const mk = (n: number, extra: Partial<Scene> = {}): Scene => ({
  scene: n, start: (n - 1) * 3, end: n * 3, narration: "문장", subtitle: "자막",
  visual_prompt: "korean restaurant", camera_motion: "slow_zoom_in",
  character_presence: "none", fact_source: "", ...extra,
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orak-clip-"));

const info = (over: Partial<VideoInfo> = {}): VideoInfo => ({
  name: "clip.mp4", sizeBytes: 1000, durationSec: 5, width: 1080, height: 1920,
  videoCodec: "h264", pixFmt: "yuv420p", hasAudio: false, audioCodec: null, ...over,
});

/**
 * 클링AI 웹에서 만들어 끌어온 장면 클립 — 렌더 명령이 이미지 장면과 클립 장면을
 * 서로 다르게, 그러나 이어붙일 수 있게 만드는지 명령 문자열로 확인한다.
 */
describe("장면 클립 렌더 명령", () => {
  const scenes = [mk(1), mk(2, { end: 6.5, start: 3 })];
  const images = new Map([[1, "/a/s1.jpg"], [2, "/a/s2.jpg"]]);
  const clips = new Map([[2, "/a/kling-2.mp4"]]);
  const base = { scenes, imageByScene: images, voicePath: "/a/v.mp3", assPath: "/a/s.ass", outPath: "/a/out.mp4" };

  it("클립 장면은 zoompan 없이 원래 움직임을 쓰고, 장면 길이에 정확히 맞춘다", () => {
    const { args } = buildRenderArgs({ ...base, videoByScene: clips });
    const graph = args[args.indexOf("-filter_complex") + 1];
    const clipChain = graph.split(";").find((p) => p.startsWith("[1:v]"))!;
    expect(clipChain).not.toContain("zoompan");
    // 길면 앞부분만(trim), 짧으면 마지막 화면 정지(tpad) — 장면 길이 3.5초
    expect(clipChain).toContain("tpad=stop_mode=clone:stop_duration=3.50");
    expect(clipChain).toContain("trim=duration=3.50");
    // 10비트 클립도 이미지 장면과 이어붙게 형식을 맞춘다
    expect(clipChain).toContain("format=yuv420p");
    // 이미지 장면(SCENE 1)은 기존 Ken Burns 그대로
    const imageChain = graph.split(";").find((p) => p.startsWith("[0:v]"))!;
    expect(imageChain).toContain("zoompan");
  });

  it("클립이 입력으로 들어가고, 소리는 나레이션 트랙만 쓴다", () => {
    const { args } = buildRenderArgs({ ...base, videoByScene: clips });
    expect(args).toContain("/a/kling-2.mp4");
    expect(args).not.toContain("/a/s2.jpg"); // 클립이 이미지를 대신한다
    // 장면당 입력 하나 → 음성 입력 인덱스는 그대로 장면 수(2)다
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[2:a]aformat");
  });

  it("클립이 있으면 이미지가 없어도 렌더할 수 있다", () => {
    const { args } = buildRenderArgs({ ...base, imageByScene: new Map([[1, "/a/s1.jpg"]]), videoByScene: clips });
    expect(args).toContain("/a/kling-2.mp4");
  });

  it("이미지도 클립도 없는 장면은 문장으로 멈춘다", () => {
    expect(() => buildRenderArgs({ ...base, imageByScene: new Map([[1, "/a/s1.jpg"]]) }))
      .toThrow(/SCENE 2/);
  });
});

describe("sceneClipMap — 클립 경로 모으기", () => {
  it("video_path 없는 장면은 이미지 방식 그대로 (빈 맵)", () => {
    expect(sceneClipMap([mk(1), mk(2)]).size).toBe(0);
  });

  it("파일이 실제로 있으면 장면 번호로 찾을 수 있다", () => {
    const clip = path.join(tmp, "있는클립.mp4");
    fs.writeFileSync(clip, "x");
    const m = sceneClipMap([mk(1), mk(2, { video_path: clip })]);
    expect(m.get(2)).toBe(clip);
    expect(m.has(1)).toBe(false);
  });

  it("경로만 있고 파일이 없으면 조용히 이미지로 넘어가지 않고 멈춘다", () => {
    expect(() => sceneClipMap([mk(1, { video_path: path.join(tmp, "없는클립.mp4") })]))
      .toThrow(/SCENE 1 .*찾을 수 없습니다/);
  });
});

describe("클립 저장 이름 — 덮어쓰기 금지", () => {
  it("같은 장면에 여러 번 넣어도 이름이 겹치지 않는다", () => {
    const a = uniqueClipPath(tmp, 3, ".MP4");
    fs.writeFileSync(a, "a");
    const b = uniqueClipPath(tmp, 3, ".mp4");
    expect(b).not.toBe(a);
    expect(fs.existsSync(b)).toBe(false);
    expect(a.endsWith(".mp4")).toBe(true); // 확장자는 소문자로 통일
    expect(path.dirname(a)).toBe(path.join(tmp, "clips"));
  });

  it("업로드 상한이 문서와 같다 (300MB)", () => {
    expect(MAX_CLIP_BYTES).toBe(300 * 1024 * 1024);
  });
});

describe("클립 안내문 — 렌더 규칙을 사람 말로", () => {
  it("가로 영상이면 세로로 잘린다고 알린다", () => {
    const notes = clipNotes(info({ width: 1920, height: 1080 }), 5);
    expect(notes.join(" ")).toContain("가로 영상");
  });
  it("클립이 장면보다 길면 앞부분만 쓴다고 알린다", () => {
    expect(clipNotes(info({ durationSec: 10 }), 3).join(" ")).toContain("앞 3초만");
  });
  it("클립이 장면보다 짧으면 마지막 화면 정지로 채운다고 알린다", () => {
    expect(clipNotes(info({ durationSec: 2 }), 5).join(" ")).toContain("마지막 화면");
  });
  it("소리가 있으면 쓰지 않는다고 알린다", () => {
    expect(clipNotes(info({ hasAudio: true }), 5).join(" ")).toContain("소리는 쓰지 않습니다");
  });
  it("딱 맞는 세로 클립이면 비율·길이 잔소리가 없다", () => {
    expect(clipNotes(info(), 5)).toEqual([]);
  });
});

/**
 * character_presence 때 실제로 겪은 함정: 저장할 자리가 없으면 DB 왕복에서 값이
 * 사라지고, 다시 만들 때 그 빈 값이 대본을 덮어쓴다. video_path 도 같은 왕복을 검사한다.
 */
describe("video_path DB 왕복", () => {
  const reelId = "reel_clip_roundtrip";

  it("저장한 클립 경로가 다시 읽어도 그대로 있다", () => {
    db().prepare("INSERT OR REPLACE INTO reels (id, title, script_json) VALUES (?,?,?)")
      .run(reelId, "클립시험", "{}");
    saveScenes(reelId, [mk(1), mk(2, { video_path: "C:\\클립\\scene-2.mp4" })]);
    const back = getReel(reelId)!.scenes;
    expect(back[1].video_path).toBe("C:\\클립\\scene-2.mp4");
    expect(back[0].video_path).toBeNull();

    // 화면 저장(PATCH)이 쓰는 SceneSchema 도 값을 흘리지 않는다
    const parsed = SceneSchema.parse(back[1]);
    expect(parsed.video_path).toBe("C:\\클립\\scene-2.mp4");

    db().prepare("DELETE FROM scenes WHERE reel_id=?").run(reelId);
    db().prepare("DELETE FROM reels WHERE id=?").run(reelId);
  });

  it("attachClip 이 기록·상태를 바꾸고, 빼면 파일은 두고 기록만 비운다", () => {
    db().prepare("INSERT OR REPLACE INTO reels (id, title, script_json, status) VALUES (?,?,?,?)")
      .run(reelId, "클립시험", JSON.stringify({ scenes: [] }), "승인");
    saveScenes(reelId, [mk(1), mk(2)]);

    const clip = path.join(tmp, "붙일클립.mp4");
    fs.writeFileSync(clip, "x");
    attachClip(reelId, 2, clip);
    let reel = getReel(reelId)!;
    expect(reel.scenes[1].video_path).toBe(clip);
    expect(reel.status).toBe("검수"); // 내용이 바뀌었으니 다시 검수부터

    attachClip(reelId, 2, null);
    reel = getReel(reelId)!;
    expect(reel.scenes[1].video_path).toBeNull();
    expect(fs.existsSync(clip)).toBe(true); // 파일은 지우지 않는다

    expect(() => attachClip(reelId, 99, clip)).toThrow(/SCENE 99/);

    db().prepare("DELETE FROM scenes WHERE reel_id=?").run(reelId);
    db().prepare("DELETE FROM reels WHERE id=?").run(reelId);
  });
});
