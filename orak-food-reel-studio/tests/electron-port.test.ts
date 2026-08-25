import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { pickPort, preferredPort, isPortFree, DEFAULT_PORT } =
  require_("../electron/port.js") as typeof import("../electron/port.js");

const opened: net.Server[] = [];
const tmpDirs: string[] = [];

/** 그 포트를 실제로 붙잡아 둔다 (막힌 상황을 흉내내지 않고 진짜로 만든다) */
function occupy(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => { opened.push(srv); resolve(); });
  });
}

function envDir(contents: string | null): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "orak-port-"));
  tmpDirs.push(d);
  if (contents !== null) fs.writeFileSync(path.join(d, ".env"), contents, "utf8");
  return d;
}

afterEach(() => {
  for (const s of opened.splice(0)) s.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("설치형 앱 포트 — 고정이 기본", () => {
  it(".env 가 없으면 3000 을 원한다", () => {
    expect(preferredPort([envDir(null)])).toBe(3000);
    expect(DEFAULT_PORT).toBe(3000);
  });

  it(".env 의 APP_PORT 를 따른다 (start.bat 과 같은 규칙)", () => {
    expect(preferredPort([envDir("APP_PORT=4100\n")])).toBe(4100);
    expect(preferredPort([envDir("# 주석\nAPP_PORT = 4200\nOTHER=1\n")])).toBe(4200);
  });

  it("APP_PORT 가 이상한 값이면 무시하고 3000 을 쓴다", () => {
    expect(preferredPort([envDir("APP_PORT=abc\n")])).toBe(3000);
    expect(preferredPort([envDir("APP_PORT=99999\n")])).toBe(3000);
    expect(preferredPort([envDir("APP_PORT=0\n")])).toBe(3000);
  });

  it("앞자리에 .env 가 없으면 다음 자리를 본다", () => {
    const missing = path.join(os.tmpdir(), "orak-없는폴더-" + process.pid);
    expect(preferredPort([missing, envDir("APP_PORT=4300\n")])).toBe(4300);
  });

  it("원하는 포트가 비어 있으면 그 포트를 그대로 쓴다", async () => {
    const dir = envDir("APP_PORT=34101\n");
    const r = await pickPort([dir]);
    expect(r).toEqual({ port: 34101, wanted: 34101, fixed: true });
  });

  it("원하는 포트가 막혀 있으면 바로 옆으로 밀고, 밀렸다고 알려 준다", async () => {
    await occupy(34110);
    const r = await pickPort([envDir("APP_PORT=34110\n")]);
    expect(r.wanted).toBe(34110);
    expect(r.port).toBe(34111);
    // fixed:false 는 "터널 명령을 바꿔야 한다" 는 신호다 — 조용히 넘어가면 안 된다
    expect(r.fixed).toBe(false);
  });

  it("연달아 막혀 있어도 빈 자리를 찾아낸다", async () => {
    for (const p of [34120, 34121, 34122]) await occupy(p);
    const r = await pickPort([envDir("APP_PORT=34120\n")]);
    expect(r.port).toBe(34123);
    expect(r.fixed).toBe(false);
  });

  it("고른 포트는 실제로 비어 있다 (짐작이 아니라 확인)", async () => {
    const r = await pickPort([envDir("APP_PORT=34130\n")]);
    expect(await isPortFree(r.port)).toBe(true);
  });

  it("막힌 포트는 막혔다고 말한다", async () => {
    await occupy(34140);
    expect(await isPortFree(34140)).toBe(false);
  });
});
