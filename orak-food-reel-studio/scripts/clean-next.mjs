/**
 * 빌드 전에 .next 를 비운다 — 지우지 못해도 업데이트를 멈추지 않는다.
 * (자세한 이유는 clean-dir.mjs 주석 참고)
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { removeDirRobust, lockAdvice } from "./clean-dir.mjs";

const TARGET = ".next";

const io = {
  exists: (p) => fs.existsSync(p),
  // maxRetries 는 노드가 EBUSY/EPERM 을 만났을 때 스스로 다시 시도하게 한다
  rm: (p) => fsp.rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }),
  rename: (a, b) => fsp.rename(a, b),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** 예전에 치워 둔 .next.old-* 를 조용히 정리 (이제는 잠금이 풀렸을 수 있다) */
async function sweepOld() {
  let names = [];
  try { names = await fsp.readdir("."); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(`${TARGET}.old-`)) continue;
    try { await fsp.rm(path.join(".", name), { recursive: true, force: true, maxRetries: 2, retryDelay: 200 }); }
    catch { /* 아직 잠겨 있으면 다음 기회에 */ }
  }
}

await sweepOld();

const r = await removeDirRobust(TARGET, io, { stamp: String(Date.now()) });
if (r.how === "renamed") {
  console.log(`[i] ${TARGET} 폴더가 사용 중이라 ${r.aside} 로 치워 두고 새로 만듭니다. (다음 실행 때 자동으로 지워집니다)`);
} else if (!r.ok) {
  console.log(lockAdvice(TARGET));
}
