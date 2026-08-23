import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("ffmpeg");
import { buildRenderArgs, escapeFilterPath } from "../src/lib/pipeline/render";
import { buildThumbnailArgs, buildThumbAss, thumbnailLines } from "../src/lib/pipeline/thumbnail";

const scenes = [
  { scene: 1, start: 0, end: 3, narration: "", subtitle: "", visual_prompt: "", camera_motion: "slow_zoom_in" as const, character_presence: "none" as const, fact_source: "" },
  { scene: 2, start: 3, end: 6.5, narration: "", subtitle: "", visual_prompt: "", camera_motion: "pan_right" as const, character_presence: "none" as const, fact_source: "" },
];
const images = new Map([[1, "/a/s1.jpg"], [2, "/a/s2.jpg"]]);

describe("§20 FFmpeg command 생성", () => {
  it("1080x1920 / H.264 / AAC / faststart 규격을 지킨다", () => {
    const { args, totalSec } = buildRenderArgs({ scenes, imageByScene: images, voicePath: "/a/v.mp3", assPath: "/a/s.ass", outPath: "/a/out.mp4" });
    const joined = args.join(" ");
    expect(totalSec).toBe(6.5);
    expect(joined).toContain("s=1080x1920");
    expect(joined).toContain("libx264");
    expect(joined).toContain("aac");
    expect(joined).toContain("+faststart");
    expect(joined).toContain("zoompan");
    expect(joined).toContain("subtitles=filename=");
  });
  it("이미지가 빠진 장면은 오류를 낸다", () => {
    expect(() => buildRenderArgs({ scenes, imageByScene: new Map([[1, "/a/s1.jpg"]]), voicePath: "/v.mp3", assPath: "/s.ass", outPath: "/o.mp4" }))
      .toThrow(/SCENE 2/);
  });
  it("BGM이 있으면 사이드체인 더킹을 넣는다", () => {
    const { args } = buildRenderArgs({ scenes, imageByScene: images, voicePath: "/v.mp3", assPath: "/s.ass", outPath: "/o.mp4", bgmPath: "/b.mp3", bgmVolumeDb: -20 });
    expect(args.join(" ")).toContain("sidechaincompress");
  });
  it("Windows 경로 콜론을 이스케이프한다", () => {
    expect(escapeFilterPath("C:\\Users\\me\\a.ass")).toBe("C\\:/Users/me/a.ass");
  });
});

describe("§23 썸네일", () => {
  it("훅을 2~3줄로 나눈다", () => {
    const lines = thumbnailLines("신림에 6천 원짜리 수상한 집이 있습니다", "신림");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(3);
  });
  it("사건 배지와 브랜드 마크가 ASS에 들어간다", () => {
    const ass = buildThumbAss(["신림에", "이런 집이?"], 7);
    expect(ass).toContain("맛집사건 #007");
    expect(ass).toContain("ORAK FOOD");
  });
  it("썸네일 명령이 단일 프레임 출력이다", () => {
    const args = buildThumbnailArgs({ baseImage: "/a.jpg", outPath: "/t.jpg", assPath: "/t.ass" });
    expect(args.join(" ")).toContain("-frames:v 1");
  });
});
