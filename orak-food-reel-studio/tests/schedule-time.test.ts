import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("schedule-time");
import { db } from "../src/lib/db";
import { normalizeSlot, earliestSlot, rescheduleAt, cancelSchedule, scheduleReel, MIN_LEAD_MINUTES } from "../src/lib/scheduler";
import { REVIEW_ITEMS, saveReview } from "../src/lib/review";
import { getReel } from "../src/lib/reels";

const NOW = new Date("2026-08-25T10:00:00");
const ALL = Object.fromEntries(REVIEW_ITEMS.map((i) => [i.key, true]));

function ready(id: string) {
  db().prepare(
    `INSERT INTO reels (id, title, status, video_path, caption, hashtags_json, script_json, factcheck_json, quality_json)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, "예약 시험", "검수", "/tmp/x.mp4", "본문", "[]", "{}",
    JSON.stringify([{ field: "매장명", value: "가", status: "확인", source: "" }]),
    JSON.stringify({ fact_blocked: false }));
  saveReview(id, ALL);
}

describe("§8 사람이 고른 발행 시각", () => {
  it("여러 가지 적는 방식을 받아 준다", () => {
    expect(normalizeSlot("2026-08-25T14:30", NOW)).toBe("2026-08-25T14:30:00");
    expect(normalizeSlot("2026-08-25 14:30", NOW)).toBe("2026-08-25T14:30:00");
    expect(normalizeSlot("2026-08-25T14:30:45", NOW)).toBe("2026-08-25T14:30:45");
  });

  it("지난 시각은 저장하지 않는다", () => {
    expect(() => normalizeSlot("2026-08-25T09:59", NOW)).toThrow(/지난 시각/);
    // 지금부터 최소 준비 시간 뒤부터 고를 수 있다
    expect(() => normalizeSlot("2026-08-25T10:02", NOW)).toThrow(/지난 시각/);
    expect(normalizeSlot("2026-08-25T10:30", NOW)).toBe("2026-08-25T10:30:00");
  });

  it("알아볼 수 없는 값은 거절한다", () => {
    expect(() => normalizeSlot("내일 오후", NOW)).toThrow(/알아볼 수 없/);
    expect(() => normalizeSlot("2026-13-45T10:00", NOW)).toThrow();
  });

  it("가장 이른 예약 시각을 화면 칸 모양으로 준다", () => {
    const e = earliestSlot(NOW);
    expect(e).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(e).getTime() - NOW.getTime()).toBeGreaterThanOrEqual(MIN_LEAD_MINUTES * 60_000 - 60_000);
  });
});

describe("예약 목록에서 고치고 취소하기", () => {
  it("시각을 바꾸면 릴스의 예정일도 따라간다", () => {
    ready("reel_s1");
    const { scheduleId } = scheduleReel("reel_s1", "2026-12-01T11:30");
    const later = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 16);
    rescheduleAt(scheduleId, later);
    const row = db().prepare("SELECT publish_at FROM schedules WHERE id=?").get(scheduleId) as { publish_at: string };
    expect(row.publish_at.slice(0, 16)).toBe(later);
    expect(getReel("reel_s1")!.planned_date).toBe(later.slice(0, 10));
  });

  it("취소하면 릴스가 검수 상태로 돌아가고 내용은 그대로다", () => {
    ready("reel_s2");
    const { scheduleId } = scheduleReel("reel_s2", "2026-12-02T11:30");
    expect(getReel("reel_s2")!.status).toBe("예약");
    cancelSchedule(scheduleId);
    expect(getReel("reel_s2")!.status).toBe("검수");
    expect(getReel("reel_s2")!.video_path, "영상은 지우지 않는다").toBe("/tmp/x.mp4");
    const row = db().prepare("SELECT status FROM schedules WHERE id=?").get(scheduleId) as { status: string };
    expect(row.status).toBe("취소");
  });

  it("이미 끝난 예약은 고치거나 취소하지 않는다", () => {
    ready("reel_s3");
    const { scheduleId } = scheduleReel("reel_s3", "2026-12-03T11:30");
    db().prepare("UPDATE schedules SET status='발행완료' WHERE id=?").run(scheduleId);
    expect(() => rescheduleAt(scheduleId, "2026-12-04T11:30")).toThrow(/바꿀 수 없/);
    expect(() => cancelSchedule(scheduleId)).toThrow(/취소할 수 없/);
  });
});
