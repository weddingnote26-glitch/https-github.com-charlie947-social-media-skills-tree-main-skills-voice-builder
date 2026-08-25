import { describe, it, expect, vi } from "vitest";
import path from "node:path";

/**
 * 설치본은 Program Files 처럼 쓰기 금지 폴더에 들어간다.
 * 데이터·영상·로그가 그쪽을 가리키면 프로그램이 아예 못 돈다.
 * 기본값(폴더 실행)은 지금까지와 똑같아야 start.bat 이 계속 동작한다.
 */
async function loadPaths(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // 모듈 최상단에서 환경변수를 읽으므로, 매번 새로 불러와야 한다
  vi.resetModules();
  const mod = await import("../src/lib/paths");
  process.env = saved;
  return mod;
}

describe("paths — 폴더 실행(기본)", () => {
  it("ORAK_HOME 이 없으면 지금까지와 같은 자리를 쓴다", async () => {
    const p = await loadPaths({ ORAK_HOME: undefined, ORAK_OUTPUT_DIR: undefined });
    expect(p.ROOT).toBe(process.cwd());
    expect(p.DIRS.data).toBe(path.join(process.cwd(), "data"));
    expect(p.DIRS.output).toBe(path.join(process.cwd(), "output"));
    expect(p.DIRS.logs).toBe(path.join(process.cwd(), "logs"));
  });
});

describe("paths — 설치본", () => {
  it("ORAK_HOME 을 주면 쓰기 폴더가 전부 그쪽으로 옮겨간다", async () => {
    const home = path.join(path.sep, "users", "someone", "AppData", "오락푸드");
    const p = await loadPaths({ ORAK_HOME: home, ORAK_OUTPUT_DIR: undefined });
    expect(p.ROOT).toBe(home);
    expect(p.DIRS.data).toBe(path.join(home, "data"));
    expect(p.DIRS.logs).toBe(path.join(home, "logs"));
    expect(p.DIRS.character).toBe(path.join(home, "assets", "character"));
    // 프로그램이 놓인 자리는 그대로여야 기본 자원을 읽어올 수 있다
    expect(p.APP_ROOT).toBe(process.cwd());
    expect(p.APP_ROOT).not.toBe(p.ROOT);
  });

  it("완성 영상 폴더는 따로 지정할 수 있다 (내 문서 아래로)", async () => {
    const home = path.join(path.sep, "home", "x");
    const out = path.join(path.sep, "users", "someone", "Documents", "오락푸드 AI릴스", "완성영상");
    const p = await loadPaths({ ORAK_HOME: home, ORAK_OUTPUT_DIR: out });
    expect(p.DIRS.output).toBe(out);
    expect(p.DIRS.data).toBe(path.join(home, "data"));  // 나머지는 그대로
  });

  it("한글과 공백이 든 경로도 그대로 쓴다", async () => {
    const home = path.join(path.sep, "사용자", "내 문서", "오락푸드 AI릴스");
    const p = await loadPaths({ ORAK_HOME: home, ORAK_OUTPUT_DIR: undefined });
    expect(p.DIRS.data).toContain("내 문서");
    expect(p.DIRS.data).toContain("오락푸드 AI릴스");
  });

  it("빈 문자열이나 공백만 있으면 무시하고 기본값을 쓴다", async () => {
    const p = await loadPaths({ ORAK_HOME: "   ", ORAK_OUTPUT_DIR: "" });
    expect(p.ROOT).toBe(process.cwd());
    expect(p.DIRS.output).toBe(path.join(process.cwd(), "output"));
  });
});
