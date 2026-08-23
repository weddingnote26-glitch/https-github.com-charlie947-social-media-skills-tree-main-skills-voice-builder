import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("voices");
import { listElevenLabsVoices } from "../src/lib/providers/tts";
import { resetEnvCache } from "../src/lib/env";

const SAMPLE = {
  voices: [
    { voice_id: "v_abc", name: "지민", category: "premade", labels: { gender: "female", age: "middle aged" }, preview_url: "https://example.com/a.mp3" },
    { voice_id: "v_def", name: "준호", category: "cloned", labels: { gender: "male" } },
  ],
};

describe("§16 ElevenLabs 목소리 목록", () => {
  beforeEach(() => { resetEnvCache(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });

  it("키가 없으면 안내 오류를 낸다", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    resetEnvCache();
    await expect(listElevenLabsVoices()).rejects.toThrow(/ElevenLabs API 키가 없습니다/);
  });

  it("응답을 화면에서 쓰기 좋은 형태로 정리한다", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    resetEnvCache();
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("/v1/voices");
      expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
      return new Response(JSON.stringify(SAMPLE), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const voices = await listElevenLabsVoices();
    expect(voices).toHaveLength(2);
    expect(voices[0]).toEqual({
      id: "v_abc", name: "지민", category: "premade",
      labels: { gender: "female", age: "middle aged" },
      previewUrl: "https://example.com/a.mp3",
    });
    // preview_url 이 없어도 빈 문자열로 안전하게 채운다
    expect(voices[1].previewUrl).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("목소리가 하나도 없으면 빈 배열", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    resetEnvCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    expect(await listElevenLabsVoices()).toEqual([]);
  });
});
