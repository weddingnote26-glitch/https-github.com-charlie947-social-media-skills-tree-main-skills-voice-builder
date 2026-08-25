import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("review");
import { db } from "../src/lib/db";
import { REVIEW_ITEMS, getReview, saveReview, clearReview, publishBlockReason } from "../src/lib/review";
import { publishNow, scheduleReel } from "../src/lib/scheduler";
import { ratioOf, humanSize } from "../src/lib/video-info";

const ALL = Object.fromEntries(REVIEW_ITEMS.map((i) => [i.key, true]));

function makeReel(id: string, opts: { video?: string | null; blocked?: boolean } = {}) {
  db().prepare(
    `INSERT INTO reels (id, title, status, video_path, caption, hashtags_json, script_json, factcheck_json, quality_json)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, "검수 시험", "검수", opts.video === undefined ? "/tmp/x.mp4" : opts.video, "본문", "[]", "{}",
    JSON.stringify([{ field: "매장명", value: "가", status: "확인", source: "" }]),
    JSON.stringify({ fact_blocked: !!opts.blocked, fact_block_reasons: opts.blocked ? ["가격 미확인"] : [] }));
}

describe("§5 발행 전 검수", () => {
  it("처음에는 다섯 항목이 모두 남아 있다", () => {
    makeReel("reel_rv1");
    const r = getReview("reel_rv1");
    expect(r.done).toBe(false);
    expect(r.missing).toHaveLength(REVIEW_ITEMS.length);
    expect(r.checkedAt).toBeNull();
  });

  it("다 확인해야 done 이 된다 — 네 개까지는 막힌다", () => {
    makeReel("reel_rv2");
    const four = Object.fromEntries(REVIEW_ITEMS.slice(0, 4).map((i) => [i.key, true]));
    expect(saveReview("reel_rv2", four).done).toBe(false);
    expect(saveReview("reel_rv2", ALL).done).toBe(true);
    expect(getReview("reel_rv2").checkedAt).not.toBeNull();
  });

  it("모르는 항목을 보내도 통과시키지 않는다", () => {
    makeReel("reel_rv3");
    // 화면에서 온 값은 그대로 믿지 않는다
    const r = saveReview("reel_rv3", { 아무거나: true } as never);
    expect(r.done).toBe(false);
  });

  it("새로고침해도 확인한 내용이 남아 있다", () => {
    makeReel("reel_rv4");
    saveReview("reel_rv4", ALL);
    expect(getReview("reel_rv4").done).toBe(true);
  });

  it("내용을 다시 만들면 검수를 처음부터 다시 한다", () => {
    makeReel("reel_rv5");
    saveReview("reel_rv5", ALL);
    clearReview("reel_rv5");
    expect(getReview("reel_rv5").done).toBe(false);
  });
});

describe("발행 관문은 한 자리에서만 판단한다", () => {
  it("영상 없음 → 팩트체크 → 검수 순으로 막는다", () => {
    makeReel("reel_gate1", { video: null });
    expect(publishBlockReason("reel_gate1")).toMatch(/영상이 없어서/);

    makeReel("reel_gate2", { blocked: true });
    expect(publishBlockReason("reel_gate2")).toMatch(/확인되지 않은 업체 정보/);

    makeReel("reel_gate3");
    expect(publishBlockReason("reel_gate3")).toMatch(/검수/);
    saveReview("reel_gate3", ALL);
    expect(publishBlockReason("reel_gate3")).toBeNull();
  });

  it("즉시 발행과 예약 둘 다 같은 관문을 지난다", () => {
    makeReel("reel_gate4");
    expect(() => publishNow("reel_gate4")).toThrow(/검수/);
    expect(() => scheduleReel("reel_gate4")).toThrow(/검수/);
    saveReview("reel_gate4", ALL);
    expect(() => publishNow("reel_gate4")).not.toThrow();
  });

  it("이미 발행 중이면 두 번 올리지 않는다", () => {
    makeReel("reel_gate5");
    saveReview("reel_gate5", ALL);
    publishNow("reel_gate5");
    expect(() => publishNow("reel_gate5")).toThrow(/이미 발행 중/);
  });

  it("이미 올라간 릴스는 다시 올리지 않는다", () => {
    makeReel("reel_gate6");
    saveReview("reel_gate6", ALL);
    db().prepare("INSERT INTO instagram_posts (id, reel_id, ig_media_id) VALUES (?,?,?)")
      .run("post_x", "reel_gate6", "IG_1234");
    expect(() => publishNow("reel_gate6")).toThrow(/이미 발행된/);
  });
});

describe("영상 정보 표시", () => {
  it("가로세로를 사람이 읽는 비율로 바꾼다", () => {
    expect(ratioOf(1080, 1920)).toBe("9:16");
    expect(ratioOf(1920, 1080)).toBe("16:9");
  });
  it("파일 크기를 읽기 쉽게 적는다", () => {
    expect(humanSize(1_700_000)).toBe("1.6MB");
    expect(humanSize(2048)).toBe("2KB");
    expect(humanSize(300)).toBe("300B");
  });
});
