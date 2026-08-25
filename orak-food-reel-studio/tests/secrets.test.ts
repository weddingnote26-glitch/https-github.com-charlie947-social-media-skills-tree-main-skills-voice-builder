import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("secrets");
import { resolveSecret, setSecret, secretStatus, getAppMode } from "../src/lib/secrets";
import { resetEnvCache } from "../src/lib/env";
import { saveSettings } from "../src/lib/settings";

describe("API 키를 화면에서 바꾸기", () => {
  beforeEach(() => { resetEnvCache(); });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); });

  it("설정에 저장한 키가 .env 보다 우선한다", () => {
    vi.stubEnv("IMAGE_API_KEY", "env-key-1234");
    resetEnvCache();
    expect(resolveSecret("IMAGE_API_KEY")).toBe("env-key-1234");

    setSecret("IMAGE_API_KEY", "settings-key-5678");
    expect(resolveSecret("IMAGE_API_KEY")).toBe("settings-key-5678");
  });

  it("저장된 키를 지우면 .env 값으로 되돌아간다", () => {
    vi.stubEnv("IMAGE_API_KEY", "env-key-1234");
    resetEnvCache();
    setSecret("IMAGE_API_KEY", "settings-key-5678");
    setSecret("IMAGE_API_KEY", "");
    expect(resolveSecret("IMAGE_API_KEY")).toBe("env-key-1234");
  });

  it("키는 암호화되어 저장되고 화면에는 일부만 노출된다", () => {
    setSecret("ANTHROPIC_API_KEY", "sk-ant-api03-verysecretvalue-ABCD");
    const st = secretStatus("ANTHROPIC_API_KEY");
    expect(st.set).toBe(true);
    expect(st.source).toBe("설정");
    expect(st.hint).toBe("sk-ant…ABCD");
    expect(st.hint).not.toContain("verysecret");
  });

  it("실행 모드는 설정이 .env 보다 우선하고 auto 면 .env 를 따른다", () => {
    vi.stubEnv("APP_MODE", "sample");
    resetEnvCache();
    saveSettings({ appMode: "auto" });
    expect(getAppMode()).toBe("sample");

    saveSettings({ appMode: "live" });
    expect(getAppMode()).toBe("live");

    saveSettings({ appMode: "sample" });
    expect(getAppMode()).toBe("sample");
  });
});
