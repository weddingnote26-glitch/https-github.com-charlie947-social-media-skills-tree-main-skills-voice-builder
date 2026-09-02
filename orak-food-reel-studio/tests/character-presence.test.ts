import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("character-presence");
import {
  ensureCharacterPresence, presenceBlockReason, countCharacter, hasCharacter,
} from "../src/lib/content/character-presence";
import { SceneSchema, type Scene } from "../src/lib/schema";

const mk = (n: number, presence: Scene["character_presence"] = "none"): Scene => ({
  scene: n, start: (n - 1) * 3, end: n * 3,
  narration: "문장", subtitle: "자막", visual_prompt: "korean restaurant",
  camera_motion: "slow_zoom_in", character_presence: presence, fact_source: "",
});

const five = () => [mk(1), mk(2), mk(3), mk(4), mk(5)];

describe("만두탐정 오락이 등장 보장", () => {
  it("대본이 캐릭터를 하나도 안 넣어도 오프닝·마무리에는 넣는다", () => {
    const r = ensureCharacterPresence(five(), "ends");
    expect(hasCharacter(r.scenes[0])).toBe(true);
    expect(hasCharacter(r.scenes[4])).toBe(true);
  });

  it("기본값은 전체의 60% 이상 등장", () => {
    const r = ensureCharacterPresence(five(), "most", 0.6);
    expect(r.count).toBeGreaterThanOrEqual(3);
  });

  it("모든 장면 설정이면 전부 등장", () => {
    expect(ensureCharacterPresence(five(), "all").count).toBe(5);
  });

  it("오프닝·마무리만 설정이면 가운데는 건드리지 않는다", () => {
    const r = ensureCharacterPresence(five(), "ends");
    expect(r.count).toBe(2);
    expect(hasCharacter(r.scenes[2])).toBe(false);
  });

  it("대본이 이미 넣은 장면은 그대로 둔다 (연출을 덮어쓰지 않는다)", () => {
    const src = [mk(1, "hero"), mk(2, "side"), mk(3), mk(4), mk(5, "hero")];
    const r = ensureCharacterPresence(src, "most");
    expect(r.scenes[0].character_presence).toBe("hero");
    expect(r.scenes[1].character_presence).toBe("side");
  });

  it("원본 배열을 고치지 않는다", () => {
    const src = five();
    ensureCharacterPresence(src, "all");
    expect(countCharacter(src)).toBe(0);
  });

  it("채워 넣은 장면은 동작과 표정을 스키마가 허용한 값으로 채운다", () => {
    const r = ensureCharacterPresence(five(), "all");
    for (const s of r.scenes) {
      expect(() => SceneSchema.parse(s)).not.toThrow();
      expect(s.character_action).toBeTruthy();
      expect(s.character_expression).toBeTruthy();
    }
  });

  it("무엇을 채웠는지 사람에게 알려 준다", () => {
    const r = ensureCharacterPresence(five(), "most");
    expect(r.summary).toContain("장면에 오락이 등장");
    expect(r.filled.length).toBeGreaterThan(0);
  });

  it("장면 1개짜리도 깨지지 않는다", () => {
    const r = ensureCharacterPresence([mk(1)], "most");
    expect(r.count).toBe(1);
  });

  it("장면이 없으면 조용히 빈 결과", () => {
    expect(ensureCharacterPresence([], "most").scenes).toEqual([]);
  });
});

describe("캐릭터가 빠진 채로 제작하지 못하게 막는다", () => {
  it("한 장면도 없으면 스펙 문구 그대로 알린다", () => {
    expect(presenceBlockReason(five(), "ORAKI_DETECTIVE"))
      .toBe("만두탐정 오락이 캐릭터가 영상에 배치되지 않았습니다.");
  });

  it("가운데만 있고 오프닝·마무리가 비면 막는다", () => {
    const src = [mk(1), mk(2, "hero"), mk(3)];
    expect(presenceBlockReason(src, "ORAKI_DETECTIVE"))
      .toContain("오프닝과 마무리");
  });

  it("규칙을 맞춘 대본은 통과", () => {
    const r = ensureCharacterPresence(five(), "most");
    expect(presenceBlockReason(r.scenes, "ORAKI_DETECTIVE")).toBeNull();
  });

  it("오락이 모드가 아니면 이 규칙을 적용하지 않는다", () => {
    expect(presenceBlockReason(five(), "PD_NORMAL")).toBeNull();
  });
});

describe("장면을 저장했다 다시 읽어도 오락이가 남아 있다 (실제로 사라졌던 버그)", () => {
  it("character_presence 가 DB 왕복에서 살아남는다", async () => {
    const { saveScenes, getReel } = await import("../src/lib/reels");
    const { db } = await import("../src/lib/db");
    const reelId = "reel_presence_roundtrip";
    db().prepare("INSERT OR REPLACE INTO reels (id, title, script_json) VALUES (?,?,?)")
      .run(reelId, "왕복시험", "{}");
    const scenes = ensureCharacterPresence(five(), "most").scenes;
    const before = countCharacter(scenes);
    expect(before).toBeGreaterThanOrEqual(3);

    saveScenes(reelId, scenes);
    const back = getReel(reelId)!.scenes;

    // 예전에는 여기서 0 이 나왔다 — scenes 테이블에 칸이 없어 읽을 때 모두 "none" 이 됐다.
    expect(countCharacter(back)).toBe(before);
    expect(back[0].character_presence).toBe(scenes[0].character_presence);
    expect(back[back.length - 1].character_presence).toBe(scenes[scenes.length - 1].character_presence);

    db().prepare("DELETE FROM scenes WHERE reel_id=?").run(reelId);
    db().prepare("DELETE FROM reels WHERE id=?").run(reelId);
  });
});
