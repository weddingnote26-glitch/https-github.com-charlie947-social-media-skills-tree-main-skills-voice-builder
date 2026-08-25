import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("db");
import { db, nextCaseNumber } from "../src/lib/db";
import { saveScenes, getReel, updateReel } from "../src/lib/reels";
import { computeNextSlot, scheduleReel, publicUrlFor } from "../src/lib/scheduler";
import { saveSettings } from "../src/lib/settings";
import { resetEnvCache } from "../src/lib/env";

describe("§38 Database 저장", () => {
  it("릴스+장면을 저장하고 다시 읽을 수 있다", () => {
    db().prepare("INSERT INTO reels (id, title, status, script_json, factcheck_json, quality_json) VALUES (?,?,?,?,?,?)")
      .run("reel_test1", "테스트", "검수", "{}", "[]", "{}");
    saveScenes("reel_test1", [
      { scene: 1, start: 0, end: 3, narration: "가", subtitle: "가", visual_prompt: "p", camera_motion: "static", character_presence: "none", fact_source: "" },
    ]);
    const reel = getReel("reel_test1")!;
    expect(reel.scenes).toHaveLength(1);
    expect(reel.scenes[0].narration).toBe("가");
    updateReel("reel_test1", { status: "승인" });
    expect(getReel("reel_test1")!.status).toBe("승인");
  });

  it("사건번호는 1부터 순서대로 발급된다", () => {
    const n = nextCaseNumber();
    db().prepare("UPDATE reels SET case_number=? WHERE id='reel_test1'").run(n);
    expect(nextCaseNumber()).toBe(n + 1);
  });
});

describe("§34 Scheduler 등록", () => {
  it("일요일이 꺼져 있으면 일요일을 건너뛴다", () => {
    saveSettings({ publishTime: "11:30" });
    // 2026-08-22(토) 12:00 기준 → 일요일 건너뛰고 월요일 08-24
    const slot = computeNextSlot(new Date("2026-08-22T12:00:00"));
    expect(slot).toBe("2026-08-24T11:30:00");
  });
  it("발행 시간 전이면 당일 슬롯을 쓴다", () => {
    const slot = computeNextSlot(new Date("2026-08-21T08:00:00")); // 금요일 아침
    expect(slot).toBe("2026-08-21T11:30:00");
  });
  it("영상이 있는 릴스만 예약된다", () => {
    expect(() => scheduleReel("reel_test1")).toThrow(/영상/);
    updateReel("reel_test1", { video_path: "/tmp/x.mp4" });
    const { publishAt } = scheduleReel("reel_test1");
    expect(publishAt).toMatch(/T11:30:00$/);
    const row = db().prepare("SELECT status FROM schedules WHERE reel_id='reel_test1'").get() as { status: string };
    expect(row.status).toBe("예약");
  });
});

describe("§32 Instagram payload", () => {
  it("공개 URL은 PUBLIC_MEDIA_BASE_URL + /output/... 형태다", () => {
    process.env.PUBLIC_MEDIA_BASE_URL = "https://media.example.com/";
    resetEnvCache();
    const url = publicUrlFor("C:\\studio\\output\\2026-08-24_x\\reel.mp4");
    expect(url).toBe("https://media.example.com/output/2026-08-24_x/reel.mp4");
  });
});
