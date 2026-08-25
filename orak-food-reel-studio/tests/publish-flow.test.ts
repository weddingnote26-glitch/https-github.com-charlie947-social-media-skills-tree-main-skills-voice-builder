import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("publish");
process.env.APP_MODE = "sample";
import { db } from "../src/lib/db";
import { publishNow, tick } from "../src/lib/scheduler";

describe("§32 발행 상태기계 (샘플 퍼블리셔)", () => {
  it("컨테이너 FINISHED 확인 후에만 publish된다", async () => {
    db().prepare(
      "INSERT INTO reels (id, title, status, video_path, thumb_path, caption, hashtags_json, script_json, factcheck_json, quality_json) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run("reel_pub1", "발행 테스트", "검수", "/tmp/reel.mp4", "/tmp/t.jpg", "본문", '["#오락푸드"]', "{}",
      JSON.stringify([{ field: "매장명", value: "x", status: "확인", source: "" }]),
      JSON.stringify({ fact_blocked: false }));
    publishNow("reel_pub1");

    await tick(); // 대기 → 컨테이너 생성
    let job = db().prepare("SELECT phase, container_id FROM publishing_jobs WHERE reel_id='reel_pub1'").get() as { phase: string; container_id: string };
    expect(job.phase).toBe("처리대기");
    expect(job.container_id).toContain("sample-container");

    // 다음 폴링 예약 시각 무시하고 두 번 더 진행 (1회차 IN_PROGRESS → 2회차 FINISHED)
    db().prepare("UPDATE publishing_jobs SET next_retry_at=NULL").run();
    await tick();
    db().prepare("UPDATE publishing_jobs SET next_retry_at=NULL").run();
    await tick();

    job = db().prepare("SELECT phase FROM publishing_jobs WHERE reel_id='reel_pub1'").get() as { phase: string; container_id: string };
    expect(job.phase).toBe("완료");
    const post = db().prepare("SELECT ig_media_id FROM instagram_posts WHERE reel_id='reel_pub1'").get() as { ig_media_id: string };
    expect(post.ig_media_id).toContain("sample-media");
    const reel = db().prepare("SELECT status FROM reels WHERE id='reel_pub1'").get() as { status: string };
    expect(reel.status).toBe("발행완료");
  });

  it("팩트체크 차단 콘텐츠는 발행되지 않는다 (§33)", async () => {
    db().prepare(
      "INSERT INTO reels (id, title, status, video_path, caption, hashtags_json, script_json, factcheck_json, quality_json) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run("reel_pub2", "차단 테스트", "검수", "/tmp/reel.mp4", "본문", "[]", "{}",
      JSON.stringify([{ field: "가격", value: "?", status: "미확인", source: "" }]),
      JSON.stringify({ fact_blocked: true, fact_block_reasons: ["가격 미확인"] }));
    // 잡을 만든 뒤 실패시키지 말고, 누른 그 자리에서 막는다 (§33)
    expect(() => publishNow("reel_pub2")).toThrow(/팩트체크/);
    await tick();
    const job = db().prepare("SELECT COUNT(*) AS c FROM publishing_jobs WHERE reel_id='reel_pub2'").get() as { c: number };
    expect(job.c, "막혔으면 발행 잡 자체가 생기지 않아야 한다").toBe(0);
  });

  it("영상이 없으면 [지금 발행] 이 막힌다", async () => {
    // 실제로 겪은 일: 영상이 없는데도 발행 잡이 만들어져 "발행완료 인데 영상 없음" 이 됐다
    db().prepare(
      "INSERT INTO reels (id, title, status, video_path, caption, hashtags_json, script_json, factcheck_json, quality_json) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run("reel_pub3", "영상 없음", "검수", null, "본문", "[]", "{}",
      JSON.stringify([{ field: "매장명", value: "x", status: "확인", source: "" }]),
      JSON.stringify({ fact_blocked: false }));

    expect(() => publishNow("reel_pub3")).toThrow(/영상이 없어서/);
    await tick();
    const job = db().prepare("SELECT COUNT(*) AS c FROM publishing_jobs WHERE reel_id='reel_pub3'").get() as { c: number };
    expect(job.c).toBe(0);
    const reel = db().prepare("SELECT status FROM reels WHERE id='reel_pub3'").get() as { status: string };
    expect(reel.status, "막혔으면 예약으로 바뀌지도 않아야 한다").toBe("검수");
  });
});
