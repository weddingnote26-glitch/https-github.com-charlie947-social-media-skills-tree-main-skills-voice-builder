import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("settings-diff");
import { AppSettingsSchema } from "../src/lib/settings";
import { describeSettingsChange } from "../src/lib/settings-diff";

const base = AppSettingsSchema.parse({});

describe("describeSettingsChange — 무엇이 바뀌었는지 문장으로", () => {
  it("이미지 모델 변경을 이전값→새값으로 말한다", () => {
    const after = { ...base, imageModel: "dall-e-3" };
    const out = describeSettingsChange({ ...base, imageModel: "gpt-image-1" }, after, { imageModel: "dall-e-3" });
    expect(out[0]).toContain("이미지 생성 모델");
    expect(out[0]).toContain("gpt-image-1");
    expect(out[0]).toContain("dall-e-3");
  });

  it("공급자는 화면에 보이는 한국어 이름으로 말한다", () => {
    const after = { ...base, imageProvider: "openai" as const };
    const out = describeSettingsChange(base, after, { imageProvider: "openai" });
    expect(out[0]).toContain("OpenAI 이미지");
  });

  it("API 키는 값을 절대 문장에 넣지 않는다", () => {
    const secret = "sk-proj-VERYSECRETVALUE123456";
    const out = describeSettingsChange(base, base, { IMAGE_API_KEY: secret });
    expect(out.join(" ")).not.toContain(secret);
    expect(out[0]).toContain("이미지 API 키가 저장되었습니다");
  });

  it("키를 비우면 지웠다고 말한다", () => {
    const out = describeSettingsChange(base, base, { ELEVENLABS_API_KEY: "" });
    expect(out[0]).toContain("지웠습니다");
  });

  it("Instagram 토큰도 값을 노출하지 않는다", () => {
    const out = describeSettingsChange(base, base, { igAccessToken: "EAAsecret" });
    expect(out.join(" ")).not.toContain("EAAsecret");
    expect(out[0]).toContain("암호화되어 저장");
  });

  it("목소리 변경을 알려준다", () => {
    const after = { ...base, tts: { ...base.tts, voiceId: "21m00Tcm4TlvDq8ikWAM" } };
    const out = describeSettingsChange(base, after, { tts: after.tts });
    expect(out[0]).toContain("목소리가");
    expect(out[0]).toContain("21m00Tcm4TlvDq8ikWAM");
  });

  it("실제로 바뀐 게 없으면 그렇게 말한다 (거짓 성공 문구를 만들지 않는다)", () => {
    const out = describeSettingsChange(base, base, { imageModel: base.imageModel });
    expect(out[0]).toContain("변경된 내용이 없습니다");
  });

  it("여러 항목이 바뀌면 여러 줄로", () => {
    const after = { ...base, imageProvider: "openai" as const, imageModel: "gpt-image-1" };
    const out = describeSettingsChange(base, after, { imageProvider: "openai", imageModel: "gpt-image-1" });
    expect(out).toHaveLength(2);
  });
});
