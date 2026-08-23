import { describe, it, expect } from "vitest";
import { describeKeyFailure, extractReason } from "../src/lib/providers/api-failure";

describe("extractReason — 서비스마다 다른 응답 모양에서 사유를 뽑는다", () => {
  it("ElevenLabs 형태", () => {
    const raw = '{"detail":{"type":"authentication_error","code":"unauthorized","message":"Invalid API key","status":"invalid_api_key"}}';
    expect(extractReason(raw)).toBe("Invalid API key (invalid_api_key)");
  });
  it("OpenAI / Gemini 형태", () => {
    expect(extractReason('{"error":{"message":"Incorrect API key provided"}}')).toBe("Incorrect API key provided");
  });
  it("JSON 이 아니면 앞부분만", () => {
    expect(extractReason("Bad Gateway")).toBe("Bad Gateway");
    expect(extractReason("")).toBe("");
  });
});

describe("describeKeyFailure — 다음에 할 일을 알려준다", () => {
  it("401 은 폐기·오타 가능성과 발급처를 알려준다", () => {
    const m = describeKeyFailure("elevenlabs", 401, '{"detail":{"message":"Invalid API key","status":"invalid_api_key"}}');
    expect(m).toContain("401");
    expect(m).toContain("elevenlabs.io");
    expect(m).toContain("Invalid API key");
  });

  it("권한 부족은 키를 다시 만들라고 하지 않는다", () => {
    // 키 자체는 맞는데 권한만 없는 경우 — 여기서 "새 키 발급"을 시키면 헛수고가 된다
    const m = describeKeyFailure("elevenlabs", 401, '{"detail":{"status":"missing_permissions","message":"The API key is missing permissions"}}');
    expect(m).toContain("권한이 부족");
    expect(m).toContain("Text to Speech");
    expect(m).not.toContain("새로 발급");
  });

  it("서비스마다 올바른 발급처를 안내한다", () => {
    expect(describeKeyFailure("anthropic", 401, "")).toContain("console.anthropic.com");
    expect(describeKeyFailure("gemini", 400, "")).toContain("aistudio.google.com");
    expect(describeKeyFailure("openai", 403, "")).toContain("platform.openai.com");
  });

  it("한도 초과와 서버 오류를 구분한다", () => {
    expect(describeKeyFailure("elevenlabs", 429, "")).toContain("남은 크레딧");
    expect(describeKeyFailure("openai", 429, "")).toContain("결제");
    expect(describeKeyFailure("openai", 503, "")).toContain("서버에 문제");
  });

  it("모르는 상태 코드는 그대로 보여준다", () => {
    expect(describeKeyFailure("openai", 418, "")).toBe("응답 418");
  });
});
