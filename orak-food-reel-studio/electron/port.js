"use strict";
/**
 * 프로그램이 열릴 포트를 정한다.
 *
 * 왜 고정인가: Cloudflare Tunnel 은 "http://localhost:3000" 처럼 포트를 못 박아 두고 쓴다.
 * 예전에는 켤 때마다 빈 포트를 아무거나 골랐기 때문에, 다시 켜면 터널이 빈 자리를 가리켜
 * 502 가 나고 발행이 조용히 실패했다. 그래서 정한 포트부터 차례로 확인한다.
 *
 * (electron 을 부르지 않는 순수 모듈 — 그래야 시험에서 그대로 돌려 볼 수 있다)
 */
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

/** start.bat · scripts/port.mjs 와 함께 쓰는 기본값 */
const DEFAULT_PORT = 3000;
/** 기본 포트가 막혔을 때 옆으로 몇 칸까지 밀어 볼지 */
const MAX_SHIFT = 10;

/** .env 의 APP_PORT 를 읽는다. 여러 자리를 순서대로 보고 처음 찾은 값을 쓴다 */
function preferredPort(dirs) {
  for (const dir of dirs) {
    try {
      const m = fs.readFileSync(path.join(dir, ".env"), "utf8").match(/^\s*APP_PORT\s*=\s*(\d+)/m);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
      }
    } catch { /* .env 가 없으면 다음 자리를 본다 */ }
  }
  return DEFAULT_PORT;
}

/** 그 포트가 지금 비어 있는지 실제로 열어 본다 (짐작하지 않는다) */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

/** 정말 다 막혔을 때 마지막으로 쓰는 아무 포트 */
function anyFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * @param {string[]} envDirs .env 를 찾아볼 자리들
 * @returns {Promise<{port:number, wanted:number, fixed:boolean}>}
 *   fixed=false 면 원하던 포트를 못 써서 밀린 것 — 터널 명령을 바꿔야 한다는 뜻이다
 */
async function pickPort(envDirs = []) {
  const wanted = preferredPort(envDirs);
  for (let p = wanted; p < wanted + MAX_SHIFT && p <= 65535; p++) {
    if (await isPortFree(p)) return { port: p, wanted, fixed: p === wanted };
  }
  return { port: await anyFreePort(), wanted, fixed: false };
}

module.exports = { pickPort, preferredPort, isPortFree, anyFreePort, DEFAULT_PORT, MAX_SHIFT };
