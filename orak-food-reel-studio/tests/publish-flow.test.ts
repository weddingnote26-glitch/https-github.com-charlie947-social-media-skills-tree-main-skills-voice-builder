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
    publishNow("reel_pub2");
    await tick();
    const job = db().prepare("SELECT phase, last_error FROM publishing_jobs WHERE reel_id='reel_pub2'").get() as { phase: string; last_error: string };
    expect(job.phase).toBe("실패");
    expect(job.last_error).toContain("팩트체크");
  });
});
