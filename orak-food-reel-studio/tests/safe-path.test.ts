import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveInside as raw } from "../electron/safe-path.js";

type Result = { ok: true; target: string } | { ok: false; reason: string };
const resolveInside = (root: string, name: unknown): Result => raw(root, name) as Result;

/** 통과했을 때만 target 을 본다 */
function target(r: Result): string {
  if (!r.ok) throw new Error(`막혔습니다: ${r.reason}`);
  return r.target;
}

/**
 * 화면(웹) 쪽은 믿을 수 없는 자리다. 폴더 열기 창구에 ".." 이나 절대경로를
 * 섞어 보내면 완성영상 폴더 밖을 열 수 있게 된다 — 그걸 막는 검사다.
 */
const ROOT = path.resolve("/home/user/완성영상");
const inside = (p: string) => p === ROOT || p.startsWith(ROOT + path.sep);

describe("완성영상 폴더 밖으로 나가지 못한다", () => {
  it("평범한 폴더 이름은 그대로 연다", () => {
    const r = resolveInside(ROOT, "2026-08-24_신림동-만두명가");
    expect(r.ok).toBe(true);
    expect(target(r)).toBe(path.join(ROOT, "2026-08-24_신림동-만두명가"));
  });

  it("이름이 비면 완성영상 폴더 자체를 연다", () => {
    for (const v of ["", "   ", null, undefined]) {
      const r = resolveInside(ROOT, v);
      expect(r.ok, String(v)).toBe(true);
      expect(target(r), String(v)).toBe(ROOT);
    }
  });

  it("상위로 올라가려는 시도를 막는다", () => {
    for (const bad of ["..", "../..", "../../etc", "a/../../../etc", "..\\\\..\\\\Windows"]) {
      const r = resolveInside(ROOT, bad);
      // 막히거나(ok:false), 폴더 안쪽으로 접혀야 한다 — 밖으로 나가면 안 된다
      if (r.ok) expect(inside(r.target), bad).toBe(true);
    }
  });

  it("절대경로를 보내도 폴더 밖으로 못 나간다", () => {
    for (const bad of ["/etc/passwd", "C:\\\\Windows\\\\System32", "\\\\\\\\서버\\\\공유"]) {
      const r = resolveInside(ROOT, bad);
      if (r.ok) expect(inside(r.target), bad).toBe(true);
    }
  });

  it("경로 조각을 섞어 보내도 마지막 이름만 쓴다", () => {
    const r = resolveInside(ROOT, "다른폴더/진짜폴더");
    expect(r.ok).toBe(true);
    expect(target(r)).toBe(path.join(ROOT, "진짜폴더"));
  });

  it("뒤에 붙은 구분자는 무시한다", () => {
    expect(target(resolveInside(ROOT, "2026-08-24/"))).toBe(path.join(ROOT, "2026-08-24"));
  });
});
