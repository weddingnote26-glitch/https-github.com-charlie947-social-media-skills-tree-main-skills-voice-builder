import { describe, it, expect } from "vitest";
// 스크립트용 순수 JS 모듈 — 배치 파일에서 노드로 바로 실행하므로 .mjs 로 둔다
import { removeDirRobust, isLockError, lockAdvice } from "../scripts/clean-dir.mjs";

/**
 * 실제로 겪은 일: 업데이트 도중 .next 삭제가 EPERM 으로 실패해
 * 업데이트 전체가 멈췄다. 지우기는 준비 작업일 뿐이라 여기서 멈추면 안 된다.
 */
const lock = (code: string) => Object.assign(new Error(code), { code });

function makeIo(behaviour: {
  rmFails?: number;          // 앞에서 몇 번이나 잠금 오류를 낼지
  rmAlwaysFails?: string;    // 계속 이 코드로 실패
  renameFails?: boolean;
  exists?: boolean;
}) {
  const calls = { rm: 0, rename: 0, slept: 0 };
  return {
    calls,
    io: {
      exists: () => behaviour.exists ?? true,
      rm: async () => {
        calls.rm++;
        if (behaviour.rmAlwaysFails) throw lock(behaviour.rmAlwaysFails);
        if (calls.rm <= (behaviour.rmFails ?? 0)) throw lock("EPERM");
      },
      rename: async () => {
        calls.rename++;
        if (behaviour.renameFails) throw lock("EPERM");
      },
      sleep: async () => { calls.slept++; },
    },
  };
}

describe("잠긴 폴더 지우기", () => {
  it("없는 폴더는 아무것도 안 한다", async () => {
    const { io, calls } = makeIo({ exists: false });
    expect(await removeDirRobust(".next", io)).toEqual({ ok: true, how: "none" });
    expect(calls.rm).toBe(0);
  });

  it("한 번에 지워지면 그대로 끝", async () => {
    const { io, calls } = makeIo({});
    const r = await removeDirRobust(".next", io);
    expect(r).toMatchObject({ ok: true, how: "removed", tries: 1 });
    expect(calls.slept).toBe(0);
  });

  it("잠깐 잠겼던 경우는 기다렸다 다시 해서 성공한다", async () => {
    const { io, calls } = makeIo({ rmFails: 2 });
    const r = await removeDirRobust(".next", io, { delayMs: 1 });
    expect(r).toMatchObject({ ok: true, how: "removed-after-retry", tries: 3 });
    expect(calls.slept).toBe(2);
  });

  it("끝까지 잠겨 있으면 이름만 바꿔 치워 두고 계속 간다", async () => {
    const { io, calls } = makeIo({ rmAlwaysFails: "EPERM" });
    const r = await removeDirRobust(".next", io, { delayMs: 1, stamp: "42" });
    expect(r).toMatchObject({ ok: true, how: "renamed", aside: ".next.old-42" });
    expect(calls.rename).toBe(1);
  });

  it("이름 바꾸기까지 막혀도 예외를 던지지 않는다 (업데이트를 멈추면 안 된다)", async () => {
    const { io } = makeIo({ rmAlwaysFails: "EBUSY", renameFails: true });
    const r = await removeDirRobust(".next", io, { delayMs: 1 });
    expect(r).toMatchObject({ ok: false, how: "skipped", code: "EBUSY" });
  });

  it("잠금이 아닌 진짜 오류는 감추지 않는다", async () => {
    const io = {
      exists: () => true,
      rm: async () => { throw Object.assign(new Error("no space"), { code: "ENOSPC" }); },
      rename: async () => {},
      sleep: async () => {},
    };
    await expect(removeDirRobust(".next", io, { delayMs: 1 })).rejects.toThrow("no space");
  });

  it("잠금 코드만 잠금으로 본다", () => {
    for (const c of ["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]) {
      expect(isLockError({ code: c })).toBe(true);
    }
    expect(isLockError({ code: "ENOENT" })).toBe(false);
    expect(isLockError(null)).toBe(false);
  });

  it("안내문은 무엇을 닫아야 하는지 알려준다", () => {
    const a = lockAdvice(".next");
    expect(a).toContain("오락푸드 프로그램");
    expect(a).toContain("OneDrive");
    expect(a).toContain("그대로 진행합니다");
  });
});
