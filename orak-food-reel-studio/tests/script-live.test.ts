import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("script-live");
process.env.APP_MODE = "live";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-0000000000000000";

import { generateScript } from "../src/lib/pipeline/script";
import type { RestaurantInfo } from "../src/lib/schema";

/**
 * 실제 사용자 화면에서 난 오류를 코드로 재현한다:
 *   대본 생성 — Cannot read properties of undefined (reading 'replace')
 * 샘플 모드에서는 안 나고 실제 모드(Claude 호출)에서만 났다.
 */
const INFO: RestaurantInfo = {
  name: "신림동 만두명가",
  area: "신림",
  address: "서울 관악구 신림동 1-1",
  phone: "",
  hours: "",
  menus: [{ name: "김치만두", price: "" }],
  keywords: ["만두"],
  field_status: {},
  source_urls: [],
} as unknown as RestaurantInfo;

function claudeScript() {
  return {
    title: "신림동 만두명가 대표 메뉴 조사",
    restaurant: "신림동 만두명가",
    target: "40~70대 관악구 주민",
    hook: "줄이 계속 생기는 집을 발견했습니다.",
    duration: 25,
    content_mode: "ORAKI_DETECTIVE",
    content_type: "관악구 대표 메뉴 조사",
    case_number: 1,
    case_title: "만두 사건",
    scenes: Array.from({ length: 6 }, (_, i) => ({
      scene: i + 1, start: i * 4, end: i * 4 + 4,
      narration: `${i + 1}번째 장면 나레이션입니다.`,
      subtitle: `장면 ${i + 1}`,
      visual_prompt: "a busy korean dumpling shop, realistic phone photo",
      camera_motion: "slow_zoom_in",
      character_action: i % 2 === 0 ? "골목 살펴보기" : null,
      character_expression: i % 2 === 0 ? "호기심" : null,
      character_presence: i % 2 === 0 ? "corner" : "none",
      fact_source: "현장",
    })),
    caption: "신림동 만두명가 다녀왔습니다.",
    hashtags: ["#신림맛집", "#만두"],
    cta: "저장해두세요.",
    verdict: { label: "오락이 탐정 판정", 가성비: 4, 맛: 4, 양: 4, 재방문: 4, 한줄판정: "재방문 의사 있습니다." },
  };
}

/** Claude Messages API 응답 모양 */
function claudeReply(body: unknown) {
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({ content: [{ type: "text", text: JSON.stringify(body) }] }),
  } as unknown as Response;
}

let realFetch: typeof globalThis.fetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

describe("실제 모드 대본 생성", () => {
  it("Claude 가 정상 JSON 을 돌려주면 대본이 나온다", async () => {
    globalThis.fetch = vi.fn(async () => claudeReply(claudeScript())) as unknown as typeof fetch;
    const s = await generateScript(INFO, { contentMode: "ORAKI_DETECTIVE", duration: 25 });
    expect(s.title).toContain("만두명가");
    expect(s.scenes.length).toBe(6);
  });

  it("응답에 hook·cta 가 빠져 있어도 터지지 않는다", async () => {
    // Claude 가 필드를 빠뜨리는 일은 흔하다 — 여기서 TypeError 가 나면 안 된다
    const partial = claudeScript() as Record<string, unknown>;
    delete partial.hook; delete partial.cta;
    globalThis.fetch = vi.fn(async () => claudeReply(partial)) as unknown as typeof fetch;
    // 빠진 값은 normalizeScriptDraft 가 채워 준다 — TypeError 로 터지지 않는 것이 핵심
    const s = await generateScript(INFO, { contentMode: "ORAKI_DETECTIVE", duration: 25 });
    expect(s.hook).toBeTruthy();
    expect(s.cta).toBeTruthy();
  });
});

/* 사용자 PC 와 다른 조건들을 하나씩 넣어 본다 — 어디서 터지는지 */
import { db } from "../src/lib/db";

describe("예전 기록이 남아 있는 상태", () => {
  it("이전 릴스의 대본 기록이 비어 있어도 터지지 않는다", async () => {
    // 실패한 제작이 남긴 반쪽짜리 줄 — 중복 검사가 이걸 읽는다
    db().prepare("INSERT INTO reels (id, title, status, script_json) VALUES (?,?,?,?)")
      .run("reel_junk1", "", "실패", "{}");
    db().prepare("INSERT INTO reels (id, title, status, script_json) VALUES (?,?,?,?)")
      .run("reel_junk2", "제목만 있음", "실패", '{"scenes":[{}]}');
    db().prepare("INSERT INTO reels (id, title, status, script_json) VALUES (?,?,?,?)")
      .run("reel_junk3", "깨진 JSON", "실패", "not json at all");

    globalThis.fetch = vi.fn(async () => claudeReply(claudeScript())) as unknown as typeof fetch;
    const s = await generateScript(INFO, { contentMode: "ORAKI_DETECTIVE", duration: 25 });
    expect(s.scenes.length).toBe(6);
  });
});

describe("Claude 응답 모양이 조금씩 다를 때", () => {
  it("코드펜스로 감싸 보내도 읽는다", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(claudeScript()) + "\n```" }] }),
    }) as unknown as Response) as unknown as typeof fetch;
    const s = await generateScript(INFO, { contentMode: "ORAKI_DETECTIVE", duration: 25 });
    expect(s.title).toContain("만두명가");
  });

  it("목록에 없는 값을 만들어도 고쳐서 쓴다", async () => {
    const draft = claudeScript() as Record<string, unknown>;
    (draft.scenes as Array<Record<string, unknown>>)[0].camera_motion = "zoom_in";
    (draft.scenes as Array<Record<string, unknown>>)[0].character_action = "음식 가리키기";
    globalThis.fetch = vi.fn(async () => claudeReply(draft)) as unknown as typeof fetch;
    const s = await generateScript(INFO, { contentMode: "ORAKI_DETECTIVE", duration: 25 });
    expect(s.scenes[0].camera_motion).toBeTruthy();
  });

  it("content_type 을 빼먹어도 터지지 않는다", async () => {
    const draft = claudeScript() as Record<string, unknown>;
    delete draft.content_type; delete draft.content_mode; delete draft.title;
    globalThis.fetch = vi.fn(async () => claudeReply(draft)) as unknown as typeof fetch;
    const s = await generateScript(INFO, { contentMode: "ORAKI_DETECTIVE", duration: 25 });
    expect(s.content_type).toBeTruthy();
  });
});
