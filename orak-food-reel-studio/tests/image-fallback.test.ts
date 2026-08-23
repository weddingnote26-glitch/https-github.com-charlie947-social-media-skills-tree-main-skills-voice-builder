import { describe, it, expect, vi, afterEach } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("imgfallback");
import { isQuotaError, friendlyImageError } from "../src/lib/providers/image";

const QUOTA_MSG = `429 {
  "error": { "code": 429, "message": "You exceeded your current quota, please check your plan and billing details." }
}`;

describe("이미지 API 한도 초과 처리", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("사용자 로그의 429 메시지를 한도 초과로 인식한다", () => {
    expect(isQuotaError(new Error(QUOTA_MSG))).toBe(true);
  });

  it("일반 오류는 한도 초과로 보지 않는다", () => {
    expect(isQuotaError(new Error("500 internal error"))).toBe(false);
    expect(isQuotaError(new Error("이미지 응답이 비어 있습니다"))).toBe(false);
  });

  it("원본 JSON 대신 한국어 안내로 바꾼다", () => {
    const msg = friendlyImageError(new Error(QUOTA_MSG));
    expect(msg).toContain("사용 한도를 초과");
    expect(msg).not.toContain("{");
    expect(friendlyImageError(new Error("401 invalid api key"))).toContain("API 키가 올바르지 않습니다");
  });
});
