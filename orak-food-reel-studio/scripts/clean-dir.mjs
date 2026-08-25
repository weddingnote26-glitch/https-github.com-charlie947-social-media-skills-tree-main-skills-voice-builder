/**
 * 윈도우에서 폴더를 지울 때 "다른 프로그램이 쓰는 중" 을 견디는 지우기.
 *
 * 겪은 일: 업데이트 중 `.next` 를 지우다 EPERM 이 나서 업데이트 전체가 멈췄다.
 * 윈도우는 파일 하나만 열려 있어도 폴더 삭제를 거부한다 — OneDrive 동기화,
 * 백신 검사, 켜져 있는 프로그램, 탐색기로 열어 둔 창 모두 원인이 된다.
 *
 * 지우는 건 "깨끗하게 다시 만들기" 를 위한 준비일 뿐이다.
 * 준비가 안 됐다고 업데이트를 통째로 실패시키는 건 손해가 훨씬 크다 →
 * ① 잠깐 기다렸다 다시 → ② 이름만 바꿔 치워두기 → ③ 그래도 안 되면 그냥 진행.
 */

/** 잠금 때문에 실패한 것인지 (다른 오류는 그대로 올려야 한다) */
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);

export function isLockError(e) {
  return !!e && LOCKED.has(e.code);
}

/**
 * @param {string} dir 지울 폴더
 * @param {{exists:Function, rm:Function, rename:Function, sleep:Function}} io
 * @param {{tries?:number, delayMs?:number, stamp?:string}} opts
 * @returns {Promise<{ok:boolean, how:string, tries?:number, aside?:string, code?:string}>}
 */
export async function removeDirRobust(dir, io, opts = {}) {
  const tries = opts.tries ?? 5;
  const delayMs = opts.delayMs ?? 400;

  if (!io.exists(dir)) return { ok: true, how: "none" };

  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      await io.rm(dir);
      return { ok: true, how: i === 0 ? "removed" : "removed-after-retry", tries: i + 1 };
    } catch (e) {
      if (!isLockError(e)) throw e; // 디스크 꽉 참 같은 진짜 오류는 감추지 않는다
      lastErr = e;
      if (i < tries - 1) await io.sleep(delayMs * (i + 1));
    }
  }

  // 안쪽 파일이 잠겨 있어도 폴더 이름은 바뀌는 경우가 많다 → 치워 두고 새로 만든다
  const aside = `${dir}.old-${opts.stamp ?? "1"}`;
  try {
    await io.rename(dir, aside);
    return { ok: true, how: "renamed", aside, tries };
  } catch (e) {
    if (!isLockError(e)) throw e;
  }

  // 여기까지 오면 지우지 못한 것 — 그래도 빌드는 이어 간다
  return { ok: false, how: "skipped", code: lastErr?.code, tries };
}

/** 무엇을 해야 하는지 알려주는 문장 (지우지 못했을 때) */
export function lockAdvice(dir) {
  return [
    `[!] ${dir} 폴더를 비우지 못했습니다. 다른 프로그램이 이 폴더의 파일을 쓰고 있습니다.`,
    "    그대로 진행합니다 — 대부분 문제없이 끝나지만, 빌드가 실패하면 아래를 확인하세요.",
    "",
    "    1) 오락푸드 프로그램이 켜져 있으면 닫아 주세요 (작업 표시줄도 확인)",
    "    2) 검은 명령창이 떠 있으면 모두 닫아 주세요",
    "    3) 이 폴더를 탐색기 창으로 열어 두었다면 닫아 주세요",
    "    4) OneDrive·구글드라이브가 이 폴더를 동기화 중이면 잠시 멈춰 주세요",
    "       (Documents 폴더는 OneDrive 가 자동으로 동기화하는 경우가 많습니다)",
    "",
  ].join("\n");
}
