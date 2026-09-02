import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("publish-guard");
import { friendlyImageError } from "../src/lib/providers/image";

/**
 * 실제로 겪은 일: 화면에 "9장이 임시 이미지입니다 (undefined)" 라고 떴다.
 * 고른 공급자가 처음부터 Sample 이면 오류가 난 적이 없어 lastErr 가 비는데,
 * 그걸 String() 하면 "undefined" 라는 글자가 그대로 사용자에게 보인다.
 */
describe("사용자 화면에 undefined 를 보여주지 않는다", () => {
  it("오류가 없는 경우에도 사람이 읽을 문장을 준다", () => {
    for (const empty of [undefined, null, ""]) {
      const msg = friendlyImageError(empty);
      expect(msg, String(empty)).not.toContain("undefined");
      expect(msg, String(empty)).not.toContain("null");
      expect(msg.length, String(empty)).toBeGreaterThan(10);
      // 무엇을 하면 되는지까지 알려준다
      expect(msg).toContain("설정");
    }
  });

  /* 한도 초과 문구는 공급자마다 다르다(Cloudflare 는 "무료 사용량"이라고 쓴다).
     예전에는 "한도" 글자만 찾다가, 다른 시험이 설정을 건드리면 같이 넘어졌다.
     문구를 하나로 못 박는 대신 "무엇이 문제이고 어디서 고치는지" 가 있는지를 본다. */
  it("진짜 오류는 그대로 설명한다", () => {
    const msg = friendlyImageError(new Error("429 quota exceeded"));
    expect(msg).not.toContain("undefined");
    expect(msg).toMatch(/한도|사용량/);
    expect(msg.length).toBeGreaterThan(10);
  });
});
