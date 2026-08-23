import { describe, it, expect, beforeEach } from "vitest";
import { redact, rememberSecret, forgetSecrets } from "../src/lib/redact";
import { checkVoiceId } from "../src/lib/providers/voice-id";

beforeEach(() => forgetSecrets());

describe("redact", () => {
  it("실제로 새어 나갔던 형태를 가린다", () => {
    // ElevenLabs 가 돌려준 오류를 그대로 화면에 찍어 키가 노출됐던 사례
    const leaked = `An invalid ID has been received: 'ELEVENLABS_API_KEY=d7da2641ec3167d093e963c0bbd93a9ec4521698d820745c066aa3d5e7112d86'. Make sure to provide a correct one.`;
    const out = redact(leaked);
    expect(out).not.toContain("d7da2641ec3167d093e963c0bbd93a9ec4521698d820745c066aa3d5e7112d86");
    expect(out).not.toContain("ELEVENLABS_API_KEY=");
    expect(out).toContain("An invalid ID has been received");
  });

  it("각 서비스의 키 형식을 가린다", () => {
    expect(redact("Bearer sk-proj-AAAAAAAAAAAAAAAAAAAA")).not.toContain("sk-proj-AAAAAAAAAAAAAAAAAAAA");
    expect(redact("key=AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAA")).not.toContain("AIzaSy");
    expect(redact("token EAAAAAAAAAAAAAAAAAAAAAAA")).not.toContain("EAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("등록된 실제 키는 어떤 형태로 섞여 있어도 지운다", () => {
    rememberSecret("my-super-secret-value-1234");
    expect(redact("응답: my-super-secret-value-1234 실패")).not.toContain("my-super-secret-value-1234");
  });

  it("평범한 문장은 건드리지 않는다", () => {
    const plain = "장면 3의 이미지 생성에 실패했습니다. 다시 시도해 주세요.";
    expect(redact(plain)).toBe(plain);
    expect(redact("")).toBe("");
  });
});

describe("checkVoiceId", () => {
  it("API 키를 붙여넣은 경우를 막는다", () => {
    expect(checkVoiceId("ELEVENLABS_API_KEY=d7da2641ec3167d093e963c0bbd93a9ec").ok).toBe(false);
    expect(checkVoiceId("d7da2641ec3167d093e963c0bbd93a9ec4521698d820745c066aa3d5e7112d86").ok).toBe(false);
    expect(checkVoiceId("sk-proj-abcdefghijklmnop").ok).toBe(false);
  });

  it("빈 값과 형식이 다른 값을 막는다", () => {
    expect(checkVoiceId("").ok).toBe(false);
    expect(checkVoiceId("   ").ok).toBe(false);
    expect(checkVoiceId("짧음").ok).toBe(false);
    expect(checkVoiceId("21m00Tcm4TlvDq8ikWAM extra").ok).toBe(false);
  });

  it("정상적인 목소리 ID는 통과시킨다", () => {
    expect(checkVoiceId("21m00Tcm4TlvDq8ikWAM").ok).toBe(true);
    expect(checkVoiceId("  21m00Tcm4TlvDq8ikWAM  ").ok).toBe(true);
    expect(checkVoiceId("EXAVITQu4vr4xnSDxMaL").ok).toBe(true);
  });

  it("막을 때는 무엇을 해야 하는지 알려준다", () => {
    expect(checkVoiceId("ELEVENLABS_API_KEY=abc").reason).toMatch(/목소리 고르기/);
  });
});
