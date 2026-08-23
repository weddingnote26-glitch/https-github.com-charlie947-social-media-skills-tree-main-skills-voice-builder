import { describe, it, expect, vi, afterEach } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("timeout");
import { fetchJson, DEFAULT_TIMEOUT_MS } from "../src/lib/providers/http";

describe("외부 호출 시간제한", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("기본 시간제한이 걸려 있다 (무한 대기 방지)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });

  it("호출 시 signal(시간제한)이 함께 전달된다", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchJson("test", "https://example.com", { method: "GET" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("시간 초과 시 한국어 안내로 바뀐다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "TimeoutError";
      throw e;
    }));
    await expect(fetchJson("test", "https://example.com", { method: "GET" }, 1000))
      .rejects.toThrow(/응답이 1초 안에 오지 않았습니다/);
  });
});
