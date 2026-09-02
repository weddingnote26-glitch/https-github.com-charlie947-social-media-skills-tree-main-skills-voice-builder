// 맨 먼저: 임시 홈·DB (assets/branding 이 프로젝트 폴더가 아니라 시험 자리에 생기게)
import { WORK } from "./imported-env";
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { findFFmpeg, findFFprobe, runFFmpeg, runFFprobe } from "../src/lib/ffmpeg";
import { resetEnvCache } from "../src/lib/env";
import { getSettings, saveSettings } from "../src/lib/settings";
import {
  buildBrandingArgs, resolveBrandImage, sniffImage, applyBranding, brandingDir, MAX_CLIP_SEC,
} from "../src/lib/pipeline/branding";
import { POST as brandingPost, GET as brandingGet } from "../src/app/api/branding/route";

void db;
const HAVE_FFMPEG = !!findFFmpeg() && !!findFFprobe();
const itFF = HAVE_FFMPEG ? it : it.skip;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });

const abs = (...p: string[]) => path.resolve(WORK, "brand", ...p);
async function makeVideo(name: string, sec: number, audio = true): Promise<string> {
  const out = abs(name); fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ["-f", "lavfi", "-i", `testsrc=size=320x240:rate=25:duration=${sec}`];
  if (audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${sec}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (audio) args.push("-c:a", "aac");
  args.push("-movflags", "+faststart", "-y", out);
  await runFFmpeg(args); return out;
}
async function makeLogo(name: string): Promise<string> {
  const out = abs(name); fs.mkdirSync(path.dirname(out), { recursive: true });
  await runFFmpeg(["-f", "lavfi", "-i", "color=c=red:s=200x100:d=1", "-frames:v", "1", "-y", out]); return out;
}
async function probe(file: string) {
  return JSON.parse(await runFFprobe(["-v", "error", "-show_streams", "-show_format", "-of", "json", file])) as {
    streams: Array<{ codec_type: string; codec_name: string; pix_fmt?: string; width?: number; height?: number }>; format: { duration: string };
  };
}
const OFF = { intro: { file: "", seconds: 2 }, outro: { file: "", seconds: 2 }, applyToReels: true, applyToImported: true };

describe("인트로·아웃트로 FFmpeg 명령 (순수)", () => {
  const base = { inPath: "/v/reel.mp4", outPath: "/v/reel.tmp.mp4", width: 1080, height: 1920, hasAudio: true };
  const filterOf = (a: string[]) => a[a.indexOf("-filter_complex") + 1];

  it("둘 다 있으면 세 토막을 이어 붙인다", () => {
    const plan = buildBrandingArgs({ ...base, intro: { imagePath: "/b/i.png", seconds: 2 }, outro: { imagePath: "/b/o.png", seconds: 3 } });
    const f = filterOf(plan.args);
    expect(f).toContain("[iv][ia][mv][ma][ov][oa]concat=n=3:v=1:a=1[v][a]");
    expect(plan.args.join(" ")).toContain("-loop 1 -t 2.0 -i /b/i.png");
    expect(plan.args.join(" ")).toContain("-loop 1 -t 3.0 -i /b/o.png");
    expect(plan.addedSec).toBe(5);
    expect(f).toContain("scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920");
  });
  it("인트로만 / 아웃트로만", () => {
    expect(filterOf(buildBrandingArgs({ ...base, intro: { imagePath: "/b/i.png", seconds: 1 } }).args)).toContain("[iv][ia][mv][ma]concat=n=2");
    expect(filterOf(buildBrandingArgs({ ...base, outro: { imagePath: "/b/o.png", seconds: 1 } }).args)).toContain("[mv][ma][ov][oa]concat=n=2");
  });
  it("본편에 소리가 없으면 본편 길이만큼만 무음을 깐다 (끝없는 입력 금지)", () => {
    const plan = buildBrandingArgs({ ...base, hasAudio: false, mainDurationSec: 12.3, intro: { imagePath: "/b/i.png", seconds: 1 } });
    expect(plan.args.join(" ")).toContain("-f lavfi -t 12.30 -i anullsrc=r=44100:cl=stereo");
    expect(filterOf(plan.args)).toContain("[1:a]aformat"); // 본편 소리 자리에 무음 입력
    expect(() => buildBrandingArgs({ ...base, hasAudio: false, intro: { imagePath: "/b/i.png", seconds: 1 } })).toThrow(/본편 길이/);
  });
  it("휴대폰 규격을 지키고 시간은 범위 안으로", () => {
    const plan = buildBrandingArgs({ ...base, intro: { imagePath: "/b/i.png", seconds: 99 } });
    const s = plan.args.join(" ");
    expect(s).toContain("-c:v libx264"); expect(s).toContain("-pix_fmt yuv420p"); expect(s).toContain("-c:a aac"); expect(s).toContain("-movflags +faststart");
    expect(plan.introSec).toBe(MAX_CLIP_SEC);
  });
  it("붙일 것이 없거나 제자리에 덮어쓰면 명령을 만들지 않는다", () => {
    expect(() => buildBrandingArgs({ ...base })).toThrow(/없습니다/);
    expect(() => buildBrandingArgs({ ...base, outPath: base.inPath, intro: { imagePath: "/b/i.png", seconds: 1 } })).toThrow(/덮어쓸 수 없습니다/);
  });
});

describe("그림 파일 거르기", () => {
  it("첫 바이트로 종류를 안다 — 확장자는 믿지 않는다", () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("webp");
    expect(sniffImage(Buffer.from("이건 그림이 아님"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
  it("branding 폴더 안의 이름만, 그림 확장자만, 실제로 있는 것만", () => {
    fs.mkdirSync(brandingDir(), { recursive: true });
    fs.writeFileSync(path.join(brandingDir(), "ok.png"), "x");
    expect(resolveBrandImage("ok.png")).toBe(path.join(brandingDir(), "ok.png"));
    expect(resolveBrandImage("../../etc/ok.png")).toBe(path.join(brandingDir(), "ok.png")); // 이름만 남긴다
    expect(resolveBrandImage("없음.png")).toBeNull();
    expect(resolveBrandImage("ok.exe")).toBeNull();
    expect(resolveBrandImage("")).toBeNull();
  });
});

describe("완성 영상에 붙이기 (FFmpeg 필요)", () => {
  itFF("앞뒤에 붙고, 원래 영상은 .raw 로 남고, 규격은 그대로", async () => {
    const video = await makeVideo("main.mp4", 2);
    const logo = await makeLogo("logo.png");
    fs.mkdirSync(brandingDir(), { recursive: true });
    fs.copyFileSync(logo, path.join(brandingDir(), "intro.png"));
    fs.copyFileSync(logo, path.join(brandingDir(), "outro.png"));
    saveSettings({ branding: { intro: { file: "intro.png", seconds: 1.5 }, outro: { file: "outro.png", seconds: 1 }, applyToReels: true, applyToImported: true } });
    try {
      const r = await applyBranding(video, "reels");
      expect(r.applied).toBe(true);
      expect(r.addedSec).toBe(2.5);
      expect(fs.existsSync(r.rawPath!)).toBe(true);
      const p = await probe(video);
      expect(parseFloat(p.format.duration)).toBeGreaterThan(4.2);   // 2 + 2.5, 약간의 오차 허용
      expect(parseFloat(p.format.duration)).toBeLessThan(4.9);
      const v = p.streams.find((s) => s.codec_type === "video")!;
      expect(v).toMatchObject({ codec_name: "h264", pix_fmt: "yuv420p", width: 320, height: 240 });
      expect(p.streams.find((s) => s.codec_type === "audio")?.codec_name).toBe("aac");
      expect(parseFloat((await probe(r.rawPath!)).format.duration)).toBeLessThan(2.3); // 원본은 그대로
    } finally {
      saveSettings({ branding: OFF });
    }
  }, 120_000);

  itFF("소리 없는 영상에도 붙는다", async () => {
    const video = await makeVideo("silent.mp4", 2, false);
    fs.mkdirSync(brandingDir(), { recursive: true });
    fs.copyFileSync(await makeLogo("logo2.png"), path.join(brandingDir(), "intro.png"));
    saveSettings({ branding: { ...OFF, intro: { file: "intro.png", seconds: 1 } } });
    try {
      const r = await applyBranding(video, "imported");
      expect(r.applied).toBe(true);
      expect((await probe(video)).streams.some((s) => s.codec_type === "audio")).toBe(true);
    } finally { saveSettings({ branding: OFF }); }
  }, 120_000);

  itFF("설정이 꺼져 있거나 그림이 없으면 아무것도 바꾸지 않는다", async () => {
    const video = await makeVideo("untouched.mp4", 1);
    const before = fs.statSync(video).size;
    // 이 시험 혼자 돌아도 되게 그림을 직접 준비한다 (다른 시험이 만든 파일에 기대지 않는다)
    fs.mkdirSync(brandingDir(), { recursive: true });
    fs.copyFileSync(await makeLogo("logo5.png"), path.join(brandingDir(), "gate.png"));
    try {
      saveSettings({ branding: OFF });
      expect((await applyBranding(video, "reels")).applied).toBe(false);
      saveSettings({ branding: { ...OFF, intro: { file: "없는파일.png", seconds: 2 } } });
      const r = await applyBranding(video, "reels");
      expect(r.applied).toBe(false); expect(r.reason).toMatch(/설정되지 않음/);
      // 그림은 있지만 "맛집 릴스에 붙이기" 가 꺼져 있다 → 손대지 않는다
      saveSettings({ branding: { ...OFF, intro: { file: "gate.png", seconds: 1 }, applyToReels: false } });
      const off = await applyBranding(video, "reels");
      expect(off.applied).toBe(false); expect(off.reason).toMatch(/붙이지 않도록 설정됨/);
      expect(fs.statSync(video).size).toBe(before);
      expect(fs.existsSync(video.replace(/\.mp4$/, ".raw.mp4"))).toBe(false);
      // 같은 설정에서 스위치만 켜면 붙는다 (위 확인이 헛돌지 않는다는 대조군)
      saveSettings({ branding: { ...OFF, intro: { file: "gate.png", seconds: 1 }, applyToReels: true } });
      expect((await applyBranding(video, "reels")).applied).toBe(true);
    } finally { saveSettings({ branding: OFF }); }
  }, 120_000);
});

describe("맛집 릴스 제작 흐름에 실제로 붙는다 (연습 모드, FFmpeg 필요)", () => {
  itFF("완성 릴스 앞뒤에 붙고 길이가 그만큼 늘어난다 · 붙이기 전 파일은 .raw 로 남는다", async () => {
    vi.stubEnv("APP_MODE", "sample"); resetEnvCache();
    const { createJob, runProductionJob, getJob } = await import("../src/lib/pipeline/run");
    const { getReel } = await import("../src/lib/reels");
    fs.mkdirSync(brandingDir(), { recursive: true });
    fs.copyFileSync(await makeLogo("logo3.png"), path.join(brandingDir(), "intro.png"));
    fs.copyFileSync(await makeLogo("logo4.png"), path.join(brandingDir(), "outro.png"));
    saveSettings({ branding: { intro: { file: "intro.png", seconds: 1 }, outro: { file: "outro.png", seconds: 1 }, applyToReels: true, applyToImported: true } });
    try {
      const jobId = createJob();
      await runProductionJob(jobId, {
        restaurantName: "신림골목만두", area: "신림", contentType: "가성비 맛집", contentMode: "ORAKI_DETECTIVE", durationSec: 15,
        manual: { name: "신림골목만두", area: "신림", menus: [{ name: "고기만두", price: "6,000원", verified: true }] },
      });
      const job = getJob(jobId)!;
      expect(job.status).toBe("완료");
      const reel = getReel(job.reel_id!)!;
      const raw = reel.video_path!.replace(/\.mp4$/, ".raw.mp4");
      expect(fs.existsSync(raw)).toBe(true);
      const rawSec = parseFloat((await probe(raw)).format.duration);
      const finalSec = parseFloat((await probe(reel.video_path!)).format.duration);
      expect(finalSec - rawSec).toBeGreaterThan(1.6);
      expect(finalSec - rawSec).toBeLessThan(2.4);
      expect(reel.duration_sec!).toBeCloseTo(finalSec, 0);        // DB 길이도 늘어난 값
      expect(job.steps.find((s) => s.key === "render")?.message).toContain("인트로·아웃트로 +2s");
    } finally { saveSettings({ branding: OFF }); }
  }, 180_000);
});

describe("올리기 API", () => {
  const post = (body: unknown) => brandingPost(new Request("http://localhost/api/branding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).then((r) => r.json() as Promise<{ ok: boolean; data?: { intro: { file: string; exists: boolean } }; error?: string }>);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it("그림을 올리면 슬롯 이름으로 저장되고 설정에 연결된다 — 떼어도 파일은 남는다", async () => {
    saveSettings({ branding: OFF });
    const up = await post({ action: "upload", slot: "intro", dataUrl: `data:image/png;base64,${pngBytes.toString("base64")}` });
    expect(up.ok).toBe(true);
    expect(up.data?.intro).toMatchObject({ file: "intro.png", exists: true });
    expect(getSettings().branding.intro.file).toBe("intro.png");
    const cl = await post({ action: "clear", slot: "intro" });
    expect(cl.data?.intro.file).toBe("");
    expect(fs.existsSync(path.join(brandingDir(), "intro.png"))).toBe(true);
    const st = await (await brandingGet()).json() as { data: { intro: { file: string } } };
    expect(st.data.intro.file).toBe("");
  });
  it("그림이 아니거나 이름이 이상하면 거부한다 (확장자가 아니라 내용으로)", async () => {
    expect((await post({ action: "upload", slot: "intro", dataUrl: "data:image/png;base64," + Buffer.from("텍스트 파일입니다!!").toString("base64") })).ok).toBe(false);
    expect((await post({ action: "upload", slot: "intro", dataUrl: "안녕" })).ok).toBe(false);
    expect((await post({ action: "upload", slot: "../x", dataUrl: `data:image/png;base64,${pngBytes.toString("base64")}` })).ok).toBe(false);
  });
});
