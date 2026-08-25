import { describe, it, expect } from "vitest";
import { checkPublicMediaUrl } from "../src/lib/media-url";

/**
 * Instagram 은 우리가 알려 준 주소로 Meta 서버가 직접 영상을 받아 간다.
 * 내 PC 에서만 열리는 주소를 넣으면 저장은 되지만 발행에서 조용히 실패한다.
 */
describe("영상 공개 주소 검사", () => {
  it("비워 두는 건 허용한다 (영상 제작만 할 때)", () => {
    expect(checkPublicMediaUrl("").ok).toBe(true);
    expect(checkPublicMediaUrl("   ").ok).toBe(true);
  });

  it("인터넷에서 열리는 https 주소는 통과", () => {
    const r = checkPublicMediaUrl("https://reels.example.com");
    expect(r.ok).toBe(true);
    expect(r.warn).toBeUndefined();
  });

  it("내 PC 안에서만 열리는 주소는 막는다", () => {
    for (const bad of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://192.168.0.12",
      "https://10.0.0.5",
      "https://172.16.3.4",
    ]) {
      const r = checkPublicMediaUrl(bad);
      expect(r.ok, bad).toBe(false);
      expect(r.reason, bad).toContain("Instagram 서버가");
    }
  });

  it("사설 대역처럼 보이지만 아닌 주소는 막지 않는다", () => {
    expect(checkPublicMediaUrl("https://172.32.0.1").ok).toBe(true);
    expect(checkPublicMediaUrl("https://11.0.0.1").ok).toBe(true);
  });

  it("주소 모양이 아니면 무엇을 넣어야 하는지 알려준다", () => {
    const r = checkPublicMediaUrl("내주소.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("https://");
  });

  it("http 는 막지 않되 https 를 권한다", () => {
    const r = checkPublicMediaUrl("http://reels.example.com");
    expect(r.ok).toBe(true);
    expect(r.warn).toContain("https");
  });
});
