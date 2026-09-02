import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("image-model");
import { modelOwner, pickImageModel, clearStaleImageModel, imageKeyMismatch } from "../src/lib/providers/image-model";
import { needsOrgVerification } from "../src/lib/providers/image";

describe("modelOwner", () => {
  it("공급자를 이름으로 구분한다", () => {
    expect(modelOwner("imagen-3.0-generate-002")).toBe("gemini");
    expect(modelOwner("gemini-2.5-flash-image")).toBe("gemini");
    expect(modelOwner("gpt-image-1")).toBe("openai");
    expect(modelOwner("dall-e-3")).toBe("openai");
    expect(modelOwner("무언가-알수없는-모델")).toBeNull();
  });
});

describe("pickImageModel", () => {
  it("비어 있으면 기본값", () => {
    expect(pickImageModel("openai", "", "gpt-image-1")).toBe("gpt-image-1");
    expect(pickImageModel("openai", undefined, "gpt-image-1")).toBe("gpt-image-1");
    expect(pickImageModel("openai", "   ", "gpt-image-1")).toBe("gpt-image-1");
  });

  it("공급자를 바꾼 뒤 남은 예전 모델은 무시한다", () => {
    // Gemini → OpenAI 로 바꿨는데 imagen 이 남은 경우
    expect(pickImageModel("openai", "imagen-3.0-generate-002", "gpt-image-1")).toBe("gpt-image-1");
    // 반대 방향
    expect(pickImageModel("gemini", "gpt-image-1", "imagen-3.0-generate-002")).toBe("imagen-3.0-generate-002");
  });

  it("같은 공급자 모델이거나 알 수 없는 이름은 그대로 쓴다", () => {
    expect(pickImageModel("openai", "dall-e-3", "gpt-image-1")).toBe("dall-e-3");
    expect(pickImageModel("gemini", "gemini-2.5-flash-image", "x")).toBe("gemini-2.5-flash-image");
    expect(pickImageModel("openai", "my-custom-model", "gpt-image-1")).toBe("my-custom-model");
  });
});

describe("clearStaleImageModel", () => {
  it("공급자가 바뀌면 다른 공급자 모델을 비운다", () => {
    expect(clearStaleImageModel("openai", "imagen-3.0-generate-002")).toBe("");
    expect(clearStaleImageModel("gemini", "gpt-image-1")).toBe("");
  });
  it("맞는 모델은 유지하고 sample 은 항상 비운다", () => {
    expect(clearStaleImageModel("openai", "gpt-image-1")).toBe("gpt-image-1");
    expect(clearStaleImageModel("sample", "gpt-image-1")).toBe("");
    expect(clearStaleImageModel("openai", undefined)).toBe("");
  });
});

describe("needsOrgVerification", () => {
  it("조직 인증 요구 오류를 알아본다", () => {
    expect(needsOrgVerification(new Error("403 Your organization must be verified to use the model `gpt-image-1`"))).toBe(true);
    expect(needsOrgVerification(new Error("400 To access gpt-image-1, please complete organization verification"))).toBe(true);
  });
  it("다른 오류와 섞이지 않는다", () => {
    expect(needsOrgVerification(new Error("401 Incorrect API key provided"))).toBe(false);
    expect(needsOrgVerification(new Error("429 quota exceeded"))).toBe(false);
    expect(needsOrgVerification(new Error("403 forbidden"))).toBe(false);
  });
});

describe("imageKeyMismatch", () => {
  it("공급자와 키 종류가 어긋나면 알려준다", () => {
    // 실제로 겪은 상황: 화면은 OpenAI인데 저장된 공급자는 Gemini라 sk- 키를 구글로 보냈다
    expect(imageKeyMismatch("gemini", "sk-proj-abc123")).toMatch(/OpenAI 이미지/);
    expect(imageKeyMismatch("openai", "AIzaSyAbc123")).toMatch(/Gemini/);
  });
  it("맞는 조합에는 간섭하지 않는다", () => {
    expect(imageKeyMismatch("openai", "sk-proj-abc123")).toBeNull();
    expect(imageKeyMismatch("gemini", "AIzaSyAbc123")).toBeNull();
    expect(imageKeyMismatch("sample", "sk-proj-abc123")).toBeNull();
    // 형식이 애매한 값은 실제 호출로 판단하게 둔다
    expect(imageKeyMismatch("openai", "AQ.Ab8xyz")).toBeNull();
  });
});
