import { describe, it, expect } from "vitest";
import { saveScenes, getReel } from "../src/lib/reels";
import { db } from "../src/lib/db";
import type { Scene } from "../src/lib/schema";

const mk = (n: number, start: number, end: number): Scene => ({
  scene: n, start, end, narration: "문장", subtitle: "자막",
  visual_prompt: "korean restaurant", camera_motion: "slow_zoom_in",
  character_presence: "none", fact_source: "",
});

/**
 * 실제로 겪은 일: 음성이 29.5초인데 [다시 만들기] 를 하면 25초짜리 영상이 나와
 * 나레이션 끝 4.5초가 잘렸다. 음성 길이에 맞춰 조정한 장면 시간을 저장하지 않아,
 * 다시 만들 때 DB 의 옛 시간이 대본을 덮어썼기 때문이다.
 */
describe("음성 길이에 맞춘 장면 시간이 저장된다", () => {
  const reelId = "reel_timing_roundtrip";

  it("조정된 끝 시간이 DB 왕복에서 그대로 남는다", () => {
    db().prepare("INSERT OR REPLACE INTO reels (id, title, script_json) VALUES (?,?,?)")
      .run(reelId, "시간시험", "{}");

    // 음성 생성 후처럼 장면 시간이 늘어난 상태
    const adjusted = [mk(1, 0, 12.3), mk(2, 12.3, 29.5)];
    saveScenes(reelId, adjusted);

    const back = getReel(reelId)!.scenes;
    expect(back[back.length - 1].end).toBeCloseTo(29.5, 2);
    expect(back[0].end).toBeCloseTo(12.3, 2);

    db().prepare("DELETE FROM scenes WHERE reel_id=?").run(reelId);
    db().prepare("DELETE FROM reels WHERE id=?").run(reelId);
  });
});
