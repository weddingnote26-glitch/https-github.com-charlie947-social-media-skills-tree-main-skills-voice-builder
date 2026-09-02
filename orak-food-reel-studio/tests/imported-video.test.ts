// 맨 먼저: 임시 DB·홈·완성영상 폴더를 정한다 (다른 import 가 paths.ts 를 굳히기 전에)
import { WORK } from "./imported-env";
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const ORIGINAL_DB = process.env.ORAK_DB_PATH as string;

import { db, resetDbForTest } from "../src/lib/db";
import { SqliteDatabase } from "../src/lib/sqlite";
import { DIRS } from "../src/lib/paths";
import { findFFmpeg, findFFprobe, runFFmpeg, runFFprobe } from "../src/lib/ffmpeg";
import { resetEnvCache } from "../src/lib/env";
import { getSettings, saveSettings } from "../src/lib/settings";
import { audioDuration } from "../src/lib/providers/tts";
import { listJobs } from "../src/lib/pipeline/jobs";
import { outputFolderName } from "../src/lib/output-folder";
import { resolveInside } from "../electron/safe-path.js";
import { VIDEO_EXTENSIONS as PICKER_EXTENSIONS } from "../electron/video-types.js";
import {
  splitNarration, parseProbeJson, buildImportedRenderArgs, checkSourcePath, inspectVideo,
  scanTopLevelBoxes, moovBeforeMdat, verifyFinalVideo, synthesizeNarration,
  createImportedJob, runImportedJob, getImportedJob, listImportedJobs, deleteImportedJobs, countImportedJobs,
  importedOutputDir, cleanupStaleImportedJobs, VIDEO_EXTENSIONS, FINAL_FILE_NAME, NARRATION_CHUNK_CHARS,
  type VideoInfo,
} from "../src/lib/pipeline/imported-video";
import { POST as createRoute, DELETE as deleteRoute } from "../src/app/api/imported/route";
import { POST as inspectRoute } from "../src/app/api/imported/inspect/route";

const HAVE_FFMPEG = !!findFFmpeg() && !!findFFprobe();
if (!HAVE_FFMPEG) console.warn("⚠ FFmpeg/FFprobe 가 없어 외부 영상 통합 시험(실제 MP4 생성)을 건너뜁니다");
const itFF = HAVE_FFMPEG ? it : it.skip;

const count = (table: string) => (db().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const absFile = (...p: string[]) => path.resolve(WORK, ...p);
const FAKE_INFO: VideoInfo = {
  name: "가짜.mp4", sizeBytes: 10, durationSec: 3, width: 320, height: 240,
  videoCodec: "h264", pixFmt: "yuv420p", hasAudio: true, audioCodec: "aac",
};

/** 시험용 영상 — testsrc 무늬 + (선택) 440Hz 소리 */
async function makeVideo(rel: string, o: { sec: number; audio: boolean; faststart?: boolean }): Promise<string> {
  const out = absFile(rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ["-f", "lavfi", "-i", `testsrc=size=320x240:rate=25:duration=${o.sec}`];
  if (o.audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${o.sec}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (o.audio) args.push("-c:a", "aac");
  if (o.faststart !== false) args.push("-movflags", "+faststart");
  args.push("-y", out);
  await runFFmpeg(args);
  return out;
}

async function makeMp3(rel: string, sec = 0.6): Promise<string> {
  const out = absFile(rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await runFFmpeg(["-f", "lavfi", "-i", `sine=frequency=300:duration=${sec}`, "-c:a", "libmp3lame", "-q:a", "6", "-y", out]);
  return out;
}

async function probe(file: string) {
  return JSON.parse(await runFFprobe(["-v", "error", "-show_streams", "-show_format", "-of", "json", file])) as {
    streams: Array<{ codec_type: string; codec_name: string; pix_fmt?: string }>; format: { duration: string };
  };
}

async function waitDone(id: string, timeoutMs = 90_000) {
  const t0 = Date.now();
  for (;;) {
    const j = getImportedJob(id);
    if (!j) throw new Error(`작업 ${id} 가 없습니다`);
    if (j.status !== "진행중") return j;
    if (Date.now() - t0 > timeoutMs) throw new Error(`작업 ${id} 가 끝나지 않습니다`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const sampleMode = () => { vi.stubEnv("APP_MODE", "sample"); resetEnvCache(); };
const readMeta = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8")) as {
  render: { final_sec: number; extended_sec: number; mixed: boolean }; verified?: { checks: string[] };
};
const postJson = (handler: (req: Request) => Promise<Response>, url: string, body: unknown, method = "POST") =>
  handler(new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
    .then((res) => res.json() as Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>);

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });

/* ───────────────────────── 순수 함수 ───────────────────────── */

describe("나레이션 나누기", () => {
  it("짧은 글은 한 조각, 글자는 하나도 잃지 않는다", () => {
    const text = "안녕하세요. 오늘은 만두집입니다!\n\n직접 확인해 보겠습니다.";
    const chunks = splitNarration(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });

  it("긴 글은 문장 끝에서만 나누고 상한을 넘기지 않는다", () => {
    const sentence = "신림동 골목 안쪽에 오래된 만두집이 있습니다. ";
    const text = sentence.repeat(120); // 약 3,000자
    const chunks = splitNarration(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(500);
      expect(c.endsWith(".")).toBe(true); // 문장 중간에서 자르지 않았다
    }
    expect(chunks.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });

  it("한 문장이 상한보다 길면 띄어쓰기에서 나눈다 — 글자를 버리지 않는다", () => {
    const text = Array.from({ length: 300 }, (_, i) => `단어${i}`).join(" ") + ".";
    const chunks = splitNarration(text, 200);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    expect(chunks.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });

  it("빈 글은 조각이 없다", () => {
    expect(splitNarration("")).toEqual([]);
    expect(splitNarration("  \n\n ")).toEqual([]);
  });

  it("기본 상한은 음성 API 가 받는 크기다", () => {
    expect(NARRATION_CHUNK_CHARS).toBeLessThanOrEqual(2500);
  });
});

describe("FFprobe 결과 읽기", () => {
  const ok = JSON.stringify({
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, pix_fmt: "yuv420p" },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: "12.345" },
  });

  it("영상·소리·길이를 요약한다", () => {
    const info = parseProbeJson(ok, "a.mp4", 100);
    expect(info).toMatchObject({ name: "a.mp4", sizeBytes: 100, durationSec: 12.35, width: 1080, height: 1920, videoCodec: "h264", hasAudio: true, audioCodec: "aac" });
  });

  it("비디오 스트림이 없으면 영상이 아니다", () => {
    const audioOnly = JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "mp3" }], format: { duration: "3" } });
    expect(() => parseProbeJson(audioOnly, "a.mp4", 100)).toThrow(/비디오\) 스트림이 없습니다/);
  });

  it("음악 파일의 표지 그림은 영상으로 치지 않는다", () => {
    const cover = JSON.stringify({
      streams: [
        { codec_type: "audio", codec_name: "mp3" },
        { codec_type: "video", codec_name: "mjpeg", width: 500, height: 500, disposition: { attached_pic: 1 } },
      ],
      format: { duration: "180" },
    });
    expect(() => parseProbeJson(cover, "a.mp4", 100)).toThrow(/비디오\) 스트림이 없습니다/);
  });

  it("소리가 없는 영상은 hasAudio=false", () => {
    const silent = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360 }], format: { duration: "2" } });
    expect(parseProbeJson(silent, "a.mp4", 1).hasAudio).toBe(false);
  });

  it("깨진 출력·길이 없음은 오류다", () => {
    expect(() => parseProbeJson("이건 JSON 이 아님", "a.mp4", 1)).toThrow(/읽지 못했습니다/);
    const noDur = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360 }], format: {} });
    expect(() => parseProbeJson(noDur, "a.mp4", 1)).toThrow(/길이를 알 수 없습니다/);
  });
});

describe("FFmpeg 명령 (합치기)", () => {
  const base = { sourcePath: "/v/원본.mp4", voicePath: "/o/voice.wav", outPath: "/o/최종_AI음성.mp4", videoSec: 10, voiceSec: 6, hasAudio: true };
  const joined = (args: string[]) => args.join(" ");

  it("휴대폰 규격: H.264 / yuv420p / AAC / +faststart, 원본과 음성 두 입력", () => {
    const { args } = buildImportedRenderArgs({ ...base, audioMode: "mute" });
    const s = joined(args);
    expect(s).toContain("-i /v/원본.mp4 -i /o/voice.wav");
    expect(s).toContain("-c:v libx264");
    expect(s).toContain("-pix_fmt yuv420p");
    expect(s).toContain("-c:a aac");
    expect(s).toContain("-movflags +faststart");
    expect(s).toContain("-map [v] -map [a]");
    expect(args[args.length - 1]).toBe("/o/최종_AI음성.mp4");
  });

  it("기존 소리 끄기 → 원본 소리를 아예 쓰지 않는다", () => {
    const plan = buildImportedRenderArgs({ ...base, audioMode: "mute" });
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(filter).not.toContain("[0:a]");
    expect(filter).not.toContain("amix");
    expect(filter).toContain("[1:a]apad[a]");
    expect(plan.mixed).toBe(false);
    expect(plan.extendedSec).toBe(0);
    expect(filter).not.toContain("tpad");
    expect(joined(plan.args)).toContain("-t 10.00"); // 원본 길이 그대로 (음성이 짧아도 영상을 자르지 않는다)
  });

  it("작게 섞기 → 원본 소리를 낮춰 AI 음성과 섞는다", () => {
    const plan = buildImportedRenderArgs({ ...base, audioMode: "mix" });
    const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
    expect(plan.mixed).toBe(true);
    expect(filter).toContain("[0:a]volume=-18dB");
    expect(filter).toContain("amix=inputs=2");
    expect(filter).toContain("normalize=0"); // 섞을 때 AI 음성이 작아지지 않게
    const custom = buildImportedRenderArgs({ ...base, audioMode: "mix", mixDb: -25 });
    expect(custom.args[custom.args.indexOf("-filter_complex") + 1]).toContain("volume=-25dB");
    // 말도 안 되는 값은 범위 안으로
    expect(buildImportedRenderArgs({ ...base, audioMode: "mix", mixDb: -99 }).args.join(" ")).toContain("volume=-40dB");
    expect(buildImportedRenderArgs({ ...base, audioMode: "mix", mixDb: 5 }).args.join(" ")).toContain("volume=0dB");
  });

  it("원본에 소리가 없으면 섞을 수 없다 → AI 음성만", () => {
    const plan = buildImportedRenderArgs({ ...base, hasAudio: false, audioMode: "mix" });
    expect(plan.mixed).toBe(false);
    expect(plan.args[plan.args.indexOf("-filter_complex") + 1]).not.toContain("[0:a]");
  });

  it("음성이 영상보다 길면 마지막 장면을 멈춰 이어 붙이고 음성을 자르지 않는다", () => {
    const plan = buildImportedRenderArgs({ ...base, voiceSec: 14.3, audioMode: "mute" });
    expect(plan.extendedSec).toBe(4.3);
    expect(plan.finalSec).toBe(14.3);
    expect(plan.args[plan.args.indexOf("-filter_complex") + 1]).toContain("tpad=stop_mode=clone:stop_duration=4.3");
    expect(joined(plan.args)).toContain("-t 14.30");
  });

  it("원본 위에 덮어쓰는 명령은 만들지 않는다", () => {
    expect(() => buildImportedRenderArgs({ ...base, outPath: "/v/원본.mp4", audioMode: "mute" })).toThrow(/덮어쓸 수 없습니다/);
  });

  it("길이를 모르면 명령을 만들지 않는다", () => {
    expect(() => buildImportedRenderArgs({ ...base, videoSec: 0, audioMode: "mute" })).toThrow(/영상 길이/);
    expect(() => buildImportedRenderArgs({ ...base, voiceSec: NaN, audioMode: "mute" })).toThrow(/음성 길이/);
  });
});

describe("faststart 판정 (MP4 상자 순서)", () => {
  const box = (type: string, payload = 0) => {
    const b = Buffer.alloc(8 + payload);
    b.writeUInt32BE(8 + payload, 0);
    b.write(type, 4, "latin1");
    return b;
  };
  const scan = (bufs: Buffer[]) => {
    const all = Buffer.concat(bufs);
    return scanTopLevelBoxes((pos, len) => all.subarray(pos, pos + len), all.length);
  };

  it("moov 가 mdat 앞이면 faststart", () => {
    expect(scan([box("ftyp", 16), box("moov", 40), box("mdat", 100)])).toBe(true);
  });
  it("mdat 가 먼저면 아니다", () => {
    expect(scan([box("ftyp", 16), box("mdat", 100), box("moov", 40)])).toBe(false);
  });
  it("64비트 크기 상자도 건너뛴다", () => {
    const big = Buffer.alloc(24);
    big.writeUInt32BE(1, 0); big.write("free", 4, "latin1"); big.writeBigUInt64BE(24n, 8);
    expect(scan([box("ftyp", 16), big, box("moov", 8), box("mdat", 8)])).toBe(true);
  });
  it("상자가 깨져 있으면 아니다", () => {
    const broken = Buffer.alloc(8); broken.writeUInt32BE(3, 0); broken.write("free", 4, "latin1");
    expect(scan([box("ftyp", 16), broken, box("moov", 8)])).toBe(false);
    expect(scan([])).toBe(false);
  });
});

/* ───────────────────────── 보안: 경로·형식 ───────────────────────── */

describe("영상 경로 거르기", () => {
  it("전체 경로만 받는다", () => {
    expect(checkSourcePath("영상.mp4")).toMatchObject({ ok: false, reason: expect.stringContaining("전체 경로") });
    expect(checkSourcePath("")).toMatchObject({ ok: false, reason: expect.stringContaining("골라") });
  });
  it("영상 확장자만 받는다", () => {
    expect(checkSourcePath(path.resolve("/x/a.txt"))).toMatchObject({ ok: false, reason: expect.stringContaining("지원하지 않는 파일 형식") });
    expect(checkSourcePath(path.resolve("/x/a.exe"))).toMatchObject({ ok: false });
    expect(checkSourcePath(path.resolve("/x/a"))).toMatchObject({ ok: false });
    for (const ext of VIDEO_EXTENSIONS) expect(checkSourcePath(path.resolve(`/x/a.${ext}`)).ok).toBe(true);
    expect(checkSourcePath(path.resolve("/x/A.MP4")).ok).toBe(true);
  });
  it("윈도우 '경로로 복사' 의 따옴표는 걷어낸다", () => {
    const p = path.resolve("/x/내 영상.mp4");
    expect(checkSourcePath(`"${p}"`)).toEqual({ ok: true, path: p });
  });
  it("폴더·없는 파일은 거부한다 (FFprobe 전에)", async () => {
    const dir = absFile("a-dir.mp4"); fs.mkdirSync(dir, { recursive: true });
    await expect(inspectVideo(dir)).rejects.toThrow(/폴더가 아니라/);
    await expect(inspectVideo(absFile("없는파일.mp4"))).rejects.toThrow(/찾을 수 없습니다/);
    const empty = absFile("빈파일.mp4"); fs.writeFileSync(empty, "");
    await expect(inspectVideo(empty)).rejects.toThrow(/빈 파일/);
  });
  itFF("확장자만 mp4 인 글 파일은 거부한다 — FFprobe 로 실제 영상인지 본다", async () => {
    const fake = absFile("fake", "가짜.mp4");
    fs.mkdirSync(path.dirname(fake), { recursive: true });
    fs.writeFileSync(fake, "이건 영상이 아닙니다. ".repeat(50));
    await expect(inspectVideo(fake)).rejects.toThrow(/영상 파일로 읽히지 않습니다|비디오\) 스트림이 없습니다/);
  });
  it("검사 API 도 같은 이유를 돌려준다 (500 이 아니라 사용자 안내)", async () => {
    const dir = absFile("b-dir.mp4"); fs.mkdirSync(dir, { recursive: true });
    const r = await postJson(inspectRoute, "/api/imported/inspect", { sourcePath: dir });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/폴더가 아니라/);
    const r2 = await postJson(inspectRoute, "/api/imported/inspect", {});
    expect(r2.ok).toBe(false);
  });
  it("파일 고르기 창(Electron)과 서버가 같은 형식 목록을 쓴다", () => {
    expect(PICKER_EXTENSIONS).toEqual(VIDEO_EXTENSIONS);
  });
});

/* ───────────────────────── 제작중 화면: 저장 폴더 열기 ───────────────────────── */

describe("저장 폴더 이름", () => {
  it("경로에서 마지막 이름만 남긴다", () => {
    expect(outputFolderName("C:\\Users\\a\\완성영상\\2026-09-02_x\\")).toBe("2026-09-02_x");
    expect(outputFolderName("/home/a/output/2026-09-02_x")).toBe("2026-09-02_x");
    expect(outputFolderName("")).toBe("");
    expect(outputFolderName(null)).toBe("");
    expect(outputFolderName("/x/..")).toBe("");
  });
  it("본체의 검사와 합쳐도 완성영상 폴더 밖으로 나갈 수 없다", () => {
    const root = path.resolve("/완성영상");
    for (const dir of ["../../etc", "C:\\Windows\\System32", "/완성영상/2026/../..", "..\\..\\x", "/etc/passwd"]) {
      const r = resolveInside(root, outputFolderName(dir));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.target === root || r.target.startsWith(root + path.sep)).toBe(true);
    }
  });
  it("제작중 목록이 릴스의 저장 폴더를 함께 준다 (없으면 null)", () => {
    db().prepare("INSERT INTO reels (id, title, output_dir) VALUES (?,?,?)").run("reel_dir", "폴더 릴스", "/out/2026-09-02_x");
    db().prepare("INSERT INTO production_jobs (id, reel_id, steps_json, status) VALUES (?,?,?,?)").run("job_dir", "reel_dir", "[]", "진행중");
    db().prepare("INSERT INTO production_jobs (id, steps_json, status) VALUES (?,?,?)").run("job_nodir", "[]", "진행중");
    const rows = listJobs("진행중");
    expect(rows.find((r) => r.id === "job_dir")?.output_dir).toBe("/out/2026-09-02_x");
    expect(rows.find((r) => r.id === "job_nodir")?.output_dir).toBeNull();
    db().prepare("DELETE FROM production_jobs WHERE id IN ('job_dir','job_nodir')").run();
    db().prepare("DELETE FROM reels WHERE id='reel_dir'").run();
  });
});

/* ───────────────────────── 작업 기록 표 ───────────────────────── */

describe("시험 자리", () => {
  it("결과물·DB·로그가 프로젝트 폴더가 아니라 시험 자리에만 생긴다", () => {
    expect(path.resolve(DIRS.output)).toBe(path.resolve(WORK, "output"));
    expect(path.resolve(DIRS.logs)).toBe(path.resolve(WORK, "home", "logs"));
    expect(ORIGINAL_DB).toBe(path.join(WORK, "test.db"));
  });
});

describe("외부 영상 작업 기록", () => {
  it("만들기·목록·개수·삭제 — 돌고 있는 작업은 지우지 않는다", () => {
    const id = createImportedJob({ sourcePath: "/v/a.mp4", narration: "안녕", voice: { voiceId: "abcDEF1234567890abcd" }, audioMode: "mix", mixDb: -22 }, FAKE_INFO);
    const row = getImportedJob(id)!;
    expect(row.status).toBe("진행중");
    expect(row.title).toBe("가짜"); // 제목이 없으면 파일 이름
    expect(row.voice).toEqual({ voiceId: "abcDEF1234567890abcd" });
    expect(row.audio_mode).toBe("mix");
    expect(row.mix_db).toBe(-22);
    expect(row.steps.map((s) => s.status)).toEqual(["대기중", "대기중", "대기중", "대기중"]);
    expect(row.source_info?.durationSec).toBe(3);
    expect(listImportedJobs("진행중").some((r) => r.id === id)).toBe(true);
    expect(countImportedJobs("진행중")).toBeGreaterThanOrEqual(1);
    expect(deleteImportedJobs([id])).toBe(0);
    db().prepare("UPDATE imported_video_jobs SET status='실패' WHERE id=?").run(id);
    expect(deleteImportedJobs([id, id, "없는것", ""])).toBe(1);
    expect(getImportedJob(id)).toBeNull();
  });

  it("서버 재시작 때 진행중으로 남은 외부 영상 작업은 실패로 정리한다 (끝난 작업은 그대로)", () => {
    const running = createImportedJob({ sourcePath: "/v/a.mp4", narration: "안녕", voice: {}, audioMode: "mute" }, FAKE_INFO);
    const done = createImportedJob({ sourcePath: "/v/b.mp4", narration: "안녕", voice: {}, audioMode: "mute" }, FAKE_INFO);
    db().prepare("UPDATE imported_video_jobs SET status='완료' WHERE id=?").run(done);
    expect(cleanupStaleImportedJobs()).toBe(1);
    expect(getImportedJob(running)).toMatchObject({ status: "실패", error: expect.stringContaining("서버가 다시 시작되어") });
    expect(getImportedJob(done)?.status).toBe("완료");
    expect(cleanupStaleImportedJobs()).toBe(0);
    db().prepare("DELETE FROM imported_video_jobs WHERE id IN (?,?)").run(running, done);
  });

  it("저장 폴더는 완성영상 폴더 아래, 같은 이름이면 번호를 붙인다 (덮어쓰지 않는다)", () => {
    const a = importedOutputDir("내 영상 (최종).mp4", "2026-09-02");
    const b = importedOutputDir("내 영상 (최종).mp4", "2026-09-02");
    expect(path.dirname(a)).toBe(path.resolve(DIRS.output));
    expect(path.basename(a)).toBe("2026-09-02_외부영상_내-영상-최종");
    expect(path.basename(b)).toBe("2026-09-02_외부영상_내-영상-최종-2");
    expect(fs.existsSync(a) && fs.existsSync(b)).toBe(true);
  });

  it("기존 DB 파일에는 표만 추가된다 — 기존 기록은 그대로", () => {
    // 옛 판 DB 흉내: 새 표 없이 production_jobs 만 있고 기록이 들어 있다
    const oldFile = absFile("old.db");
    const old = new SqliteDatabase(oldFile);
    old.exec(`CREATE TABLE production_jobs (
      id TEXT PRIMARY KEY, reel_id TEXT, steps_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT '대기', error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    old.prepare("INSERT INTO production_jobs (id, status) VALUES (?,?)").run("j_old", "완료");
    old.close();
    try {
      resetDbForTest(oldFile);
      expect(count("production_jobs")).toBe(1);
      expect(db().prepare("SELECT status FROM production_jobs WHERE id='j_old'").get()).toEqual({ status: "완료" });
      expect(count("imported_video_jobs")).toBe(0);
      expect(listJobs("완료")[0]?.output_dir).toBeNull(); // 새 열이 없어도 목록이 돈다
    } finally {
      resetDbForTest(ORIGINAL_DB);
    }
  });
});

/* ───────────────────────── 시작 API 검사 ───────────────────────── */

describe("시작 API 의 입력 검사", () => {
  const src = path.resolve("/x/a.mp4");
  it("목소리 ID 칸에 API 키가 들어가면 시작하지 않는다", async () => {
    const r = await postJson(createRoute, "/api/imported", { sourcePath: src, narration: "안녕", voiceId: "ELEVENLABS_API_KEY=abc" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/API 키/);
  });
  it("모델 칸에 목소리 ID 가 들어가면 시작하지 않는다", async () => {
    const r = await postJson(createRoute, "/api/imported", { sourcePath: src, narration: "안녕", model: "abcDEF1234567890abcd" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Model/);
  });
  it("나레이션이 비면 시작하지 않는다", async () => {
    const r = await postJson(createRoute, "/api/imported", { sourcePath: src, narration: "   " });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/나레이션/);
  });
  it("지원하지 않는 형식이면 시작하지 않는다", async () => {
    const r = await postJson(createRoute, "/api/imported", { sourcePath: path.resolve("/x/a.txt"), narration: "안녕" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/지원하지 않는 파일 형식/);
  });
  it("삭제 API 는 돌고 있는 작업을 지우지 않는다", async () => {
    const id = createImportedJob({ sourcePath: "/v/a.mp4", narration: "안녕", voice: {}, audioMode: "mute" }, FAKE_INFO);
    const r = await postJson(deleteRoute, "/api/imported", { ids: [id] }, "DELETE");
    expect(r.ok).toBe(true);
    expect(r.data?.removed).toBe(0);
    db().prepare("DELETE FROM imported_video_jobs WHERE id=?").run(id);
  });
});

/* ───────────────────────── 통합: 실제 MP4 ───────────────────────── */

describe("연습 모드로 처음부터 끝까지 (FFmpeg 필요)", () => {
  itFF("기존 소리 끄기 — 음성이 영상보다 길면 늘려 붙이고, 검증까지 통과해야 완료", async () => {
    sampleMode();
    const src = await makeVideo("e2e-mute/원본 영상.mp4", { sec: 3, audio: true });
    const before = { size: fs.statSync(src).size, sha: sha(src), siblings: fs.readdirSync(path.dirname(src)) };
    const jobsBefore = count("production_jobs");
    const reelsBefore = count("reels");

    const info = await inspectVideo(src);
    expect(info).toMatchObject({ hasAudio: true, width: 320, height: 240, videoCodec: "h264" });
    expect(info.durationSec).toBeGreaterThan(2.5);

    // 40자 이상 → 연습 모드 샘플 톤이 3초짜리 영상보다 길다
    const narration = "안녕하세요. 오늘은 신림동 골목에 숨은 만두집을 소개합니다. 직접 확인해 보겠습니다. 끝까지 봐 주세요.";
    const id = createImportedJob({ sourcePath: src, narration, voice: {}, audioMode: "mute" }, info);
    await runImportedJob(id);

    const job = getImportedJob(id)!;
    expect(job.status).toBe("완료");
    expect(job.steps.map((s) => s.status)).toEqual(["완료", "완료", "완료", "완료"]);
    expect(job.error).toBeNull();
    expect(job.final_path && path.basename(job.final_path)).toBe(FINAL_FILE_NAME);
    expect(fs.existsSync(job.final_path!)).toBe(true);

    // 완성영상 폴더 아래 새 폴더에만 쓴다
    expect(path.resolve(job.output_dir!).startsWith(path.resolve(DIRS.output) + path.sep)).toBe(true);
    expect(path.basename(job.output_dir!)).toMatch(/^\d{4}-\d{2}-\d{2}_외부영상_/);
    expect(fs.readFileSync(path.join(job.output_dir!, "narration.txt"), "utf8")).toBe(narration);

    // 원본은 그대로, 원본 폴더에도 아무것도 쓰지 않았다
    expect(fs.statSync(src).size).toBe(before.size);
    expect(sha(src)).toBe(before.sha);
    expect(fs.readdirSync(path.dirname(src))).toEqual(before.siblings);

    // 음성이 잘리지 않았다 — 영상(3s)보다 긴 음성만큼 늘어났다
    const voiceSec = await audioDuration(job.voice_path!);
    expect(voiceSec).toBeGreaterThan(info.durationSec + 1);
    expect(job.duration_sec!).toBeGreaterThanOrEqual(voiceSec - 0.35);
    const meta = readMeta(job.output_dir!);
    expect(meta.render.extended_sec).toBeGreaterThan(0);
    expect(meta.render.mixed).toBe(false);
    expect(meta.verified?.checks.length).toBeGreaterThanOrEqual(5);

    // 규격을 직접 다시 확인
    const p = await probe(job.final_path!);
    expect(p.streams.find((s) => s.codec_type === "video")).toMatchObject({ codec_name: "h264", pix_fmt: "yuv420p" });
    expect(p.streams.find((s) => s.codec_type === "audio")).toMatchObject({ codec_name: "aac" });
    expect(moovBeforeMdat(job.final_path!)).toBe(true);

    // 맛집 릴스 표는 건드리지 않았고, 전체 설정도 그대로다
    expect(count("production_jobs")).toBe(jobsBefore);
    expect(count("reels")).toBe(reelsBefore);
    expect(getSettings().tts.voiceId).toBe("");
  }, 120_000);

  itFF("기존 소리 작게 섞기 — 영상이 더 길면 영상을 자르지 않는다", async () => {
    sampleMode();
    const src = await makeVideo("e2e-mix/원본.mp4", { sec: 5, audio: true });
    const info = await inspectVideo(src);
    const id = createImportedJob({ sourcePath: src, narration: "안녕하세요.", voice: {}, audioMode: "mix", mixDb: -20 }, info);
    await runImportedJob(id);
    const job = getImportedJob(id)!;
    expect(job.status).toBe("완료");
    expect(job.duration_sec!).toBeGreaterThanOrEqual(info.durationSec - 0.35);
    const meta = readMeta(job.output_dir!);
    expect(meta.render.mixed).toBe(true);
    expect(meta.render.extended_sec).toBe(0);
    expect(job.steps[2].message).toContain("-20dB");
  }, 120_000);

  itFF("원본에 소리가 없는데 섞기를 골라도 AI 음성만 넣고 알린다", async () => {
    sampleMode();
    const src = await makeVideo("e2e-silent/원본.mp4", { sec: 2, audio: false });
    const info = await inspectVideo(src);
    expect(info.hasAudio).toBe(false);
    const id = createImportedJob({ sourcePath: src, narration: "안녕하세요.", voice: {}, audioMode: "mix" }, info);
    await runImportedJob(id);
    const job = getImportedJob(id)!;
    expect(job.status).toBe("완료");
    expect(readMeta(job.output_dir!).render.mixed).toBe(false);
    expect(job.steps[2].message).toContain("원본에 소리가 없어");
  }, 120_000);

  itFF("원본이 사라지면 실패로 기록되고 완료가 되지 않는다", async () => {
    sampleMode();
    const src = await makeVideo("e2e-fail/원본.mp4", { sec: 2, audio: false });
    const info = await inspectVideo(src);
    const id = createImportedJob({ sourcePath: src, narration: "안녕하세요.", voice: {}, audioMode: "mute" }, info);
    fs.unlinkSync(src);
    await expect(runImportedJob(id)).rejects.toThrow();
    const job = getImportedJob(id)!;
    expect(job.status).toBe("실패");
    expect(job.steps[0].status).toBe("실패");
    expect(job.error).toMatch(/찾을 수 없습니다/);
    expect(job.final_path).toBeNull();
  }, 60_000);

  itFF("시작 API — '기본 목소리로 저장' 을 고르지 않으면 설정이 바뀌지 않고, 고르면 바뀐다", async () => {
    sampleMode();
    const src = await makeVideo("api/원본.mp4", { sec: 2, audio: false });
    const base = { sourcePath: src, narration: "안녕하세요.", voiceId: "abcDEF1234567890abcd", model: "eleven_multilingual_v2", speed: 1.1, audioMode: "mute" };
    const settingsBefore = getSettings().tts;
    try {
      const r1 = await postJson(createRoute, "/api/imported", base);
      expect(r1.ok).toBe(true);
      expect(r1.data?.mode).toBe("sample");
      expect(getSettings().tts).toEqual(settingsBefore); // 이번 작업에만 적용

      const r2 = await postJson(createRoute, "/api/imported", { ...base, saveAsDefault: true });
      expect(r2.ok).toBe(true);
      expect(getSettings().tts).toMatchObject({ voiceId: "abcDEF1234567890abcd", model: "eleven_multilingual_v2", speed: 1.1 });

      const j1 = await waitDone(r1.data!.jobId as string);
      const j2 = await waitDone(r2.data!.jobId as string);
      expect(j1.status).toBe("완료");
      expect(j2.status).toBe("완료");
      expect(j1.voice).toEqual({ voiceId: "abcDEF1234567890abcd", model: "eleven_multilingual_v2", speed: 1.1 });
      expect(j1.output_dir).not.toBe(j2.output_dir); // 같은 원본이라도 폴더를 덮어쓰지 않는다
    } finally {
      saveSettings({ tts: settingsBefore });
    }
  }, 120_000);
});

describe("결과 검증은 나쁜 파일을 통과시키지 않는다 (FFmpeg 필요)", () => {
  itFF("faststart 가 없으면 실패", async () => {
    const f = await makeVideo("verify/nofast.mp4", { sec: 2, audio: true, faststart: false });
    expect(moovBeforeMdat(f)).toBe(false);
    await expect(verifyFinalVideo(f, { voiceSec: 1, videoSec: 2 })).rejects.toThrow(/faststart/);
  });
  itFF("소리가 없으면 실패", async () => {
    const f = await makeVideo("verify/silent.mp4", { sec: 2, audio: false });
    await expect(verifyFinalVideo(f, { voiceSec: 1, videoSec: 2 })).rejects.toThrow(/오디오 스트림이 없습니다/);
  });
  itFF("음성보다 짧으면 실패 (음성이 잘린 것)", async () => {
    const f = await makeVideo("verify/short.mp4", { sec: 2, audio: true });
    await expect(verifyFinalVideo(f, { voiceSec: 5, videoSec: 2 })).rejects.toThrow(/음성이 잘렸습니다/);
    await expect(verifyFinalVideo(f, { voiceSec: 1, videoSec: 4 })).rejects.toThrow(/원본 영상.*보다 짧습니다/);
  });
  itFF("좋은 파일은 통과하고, 가운데가 깨진 파일은 실패", async () => {
    const good = await makeVideo("verify/good.mp4", { sec: 2, audio: true });
    const ok = await verifyFinalVideo(good, { voiceSec: 1, videoSec: 2 });
    expect(ok.faststart).toBe(true);
    expect(ok.checks).toContain("전체 디코딩 통과");

    const broken = absFile("verify/broken.mp4");
    const bytes = fs.readFileSync(good);
    crypto.randomFillSync(bytes, Math.floor(bytes.length * 0.55), Math.floor(bytes.length * 0.2));
    fs.writeFileSync(broken, bytes);
    await expect(verifyFinalVideo(broken, { voiceSec: 1, videoSec: 2 })).rejects.toThrow(/결과 검증 실패/);
    await expect(verifyFinalVideo(absFile("verify/없음.mp4"), { voiceSec: 1, videoSec: 2 })).rejects.toThrow(/만들어지지 않았습니다/);
  }, 60_000);
});

describe("실제 모드 — 고른 목소리·모델·속도가 그대로 요청에 실린다 (FFmpeg 필요, 실제 호출 없음)", () => {
  itFF("ElevenLabs 요청 주소·본문에 이번 작업의 선택값이 들어가고, 전체 설정은 안 바뀐다", async () => {
    vi.stubEnv("APP_MODE", "live");
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    resetEnvCache();
    const mp3 = fs.readFileSync(await makeMp3("live/fake.mp3"));
    const calls: Array<{ url: string; body: { model_id: string; voice_settings: { speed: number; stability: number } }; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      return new Response(new Uint8Array(mp3), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }));

    const outDir = absFile("live/out");
    fs.mkdirSync(outDir, { recursive: true });
    const r = await synthesizeNarration("첫 문장입니다. 둘째 문장입니다.", outDir, { voiceId: "abcDEF1234567890abcd", model: "eleven_test_model", speed: 0.9 });
    expect(r.provider).toBe("elevenlabs");
    expect(r.chunks).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/v1/text-to-speech/abcDEF1234567890abcd");
    expect(calls[0].body.model_id).toBe("eleven_test_model");
    expect(calls[0].body.voice_settings.speed).toBe(0.9);
    expect(calls[0].body.voice_settings.stability).toBe(getSettings().tts.stability); // 안 고른 값은 설정값
    expect(calls[0].headers["xi-api-key"]).toBe("test-key");
    expect(fs.existsSync(r.voicePath)).toBe(true);
    expect(r.totalSec).toBeGreaterThan(0.4);
    expect(getSettings().tts.voiceId).toBe(""); // 전체 설정은 그대로
  }, 60_000);

  itFF("목소리를 고르지 않았고 설정에도 없으면 실제 호출 전에 막는다", async () => {
    vi.stubEnv("APP_MODE", "live");
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    resetEnvCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outDir = absFile("live/novoice");
    fs.mkdirSync(outDir, { recursive: true });
    await expect(synthesizeNarration("안녕하세요.", outDir, {})).rejects.toThrow(/목소리/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
