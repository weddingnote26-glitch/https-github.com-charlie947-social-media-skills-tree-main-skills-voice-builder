import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("publish-confirm");
import { db } from "../src/lib/db";
import { publishNow } from "../src/lib/scheduler";
import { REVIEW_ITEMS, saveReview } from "../src/lib/review";
import { publishPreflight } from "../src/lib/publish-check";

const ALL = Object.fromEntries(REVIEW_ITEMS.map((i) => [i.key, true]));

function makeReel(id: string, video: string | null = "/tmp/x.mp4") {
  db().prepare(
    `INSERT INTO reels (id, title, status, video_path, caption, hashtags_json, script_json, factcheck_json, quality_json)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, "확인창 시험", "검수", video, "본문입니다", '["#오락푸드"]', "{}",
    JSON.stringify([{ field: "매장명", value: "가", status: "확인", source: "" }]),
    JSON.stringify({ fact_blocked: false }));
}

describe("§6 같은 릴스를 두 번 올리지 않는다", () => {
  it("같은 요청 열쇠로 두 번 눌러도 잡은 하나뿐이다", () => {
    makeReel("reel_key1");
    saveReview("reel_key1", ALL);
    const a = publishNow("reel_key1", "key-aaaaaaaa");
    const b = publishNow("reel_key1", "key-aaaaaaaa");   // 단추 연타 / 새로고침 재전송
    expect(b.jobId).toBe(a.jobId);
    expect(b.reused).toBe(true);
    const n = db().prepare("SELECT COUNT(*) AS c FROM publishing_jobs WHERE reel_id='reel_key1'").get() as { c: number };
    expect(n.c).toBe(1);
  });

  it("열쇠가 없어도 진행 중이면 새 잡을 만들지 않는다", () => {
    makeReel("reel_key2");
    saveReview("reel_key2", ALL);
    publishNow("reel_key2");
    expect(() => publishNow("reel_key2")).toThrow(/이미 발행 중/);
  });
});

describe("§7 게시 직전 확인 — 여기서는 아무것도 올리지 않는다", () => {
  it("무엇이 막고 있는지 항목별로 알려 준다", async () => {
    makeReel("reel_pre1");
    const pre = await publishPreflight("reel_pre1");
    expect(pre.canPublish).toBe(false);
    const keys = pre.lines.map((l) => l.key);
    for (const k of ["token", "userId", "login", "review", "publicUrl", "videoFile"]) {
      expect(keys, `${k} 확인 줄이 있어야 한다`).toContain(k);
    }
    // 검수를 안 했으니 그것이 막고 있어야 한다
    expect(pre.blockers.join(" ")).toMatch(/검수/);
  });

  it("토큰을 화면으로 내보내지 않는다", async () => {
    makeReel("reel_pre2");
    const pre = await publishPreflight("reel_pre2");
    const text = JSON.stringify(pre);
    // 앞뒤 몇 글자(힌트)만 나가야 하고 전체 토큰은 절대 나가면 안 된다
    expect(text).not.toMatch(/IGAA[A-Za-z0-9]{20,}/);
    expect(text).not.toMatch(/EAA[A-Za-z0-9]{20,}/);
    expect(text.toLowerCase()).not.toContain("authorization");
  });

  it("이미 올라간 릴스는 중복 게시로 표시한다", async () => {
    makeReel("reel_pre3");
    saveReview("reel_pre3", ALL);
    db().prepare("INSERT INTO instagram_posts (id, reel_id, ig_media_id, permalink) VALUES (?,?,?,?)")
      .run("igp_1", "reel_pre3", "IG_9999", "https://instagram.com/p/x");
    const pre = await publishPreflight("reel_pre3");
    expect(pre.alreadyPosted?.mediaId).toBe("IG_9999");
    expect(pre.canPublish).toBe(false);
    expect(pre.blockers.join(" ")).toMatch(/이미/);
  });

  it("영상 파일이 없으면 막는다", async () => {
    makeReel("reel_pre4", null);
    saveReview("reel_pre4", ALL);
    const pre = await publishPreflight("reel_pre4");
    expect(pre.canPublish).toBe(false);
    expect(pre.blockers.join(" ")).toMatch(/영상/);
  });
});
