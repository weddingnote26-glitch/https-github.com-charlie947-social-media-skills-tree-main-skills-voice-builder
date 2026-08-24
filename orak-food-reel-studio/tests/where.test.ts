import { describe, it, expect } from "vitest";
import { codeLocation, isProgramBug, bugTag } from "../src/lib/where";

/**
 * 실제로 겪은 일: 화면에 "Cannot read properties of undefined (reading 'replace')"
 * 한 줄만 나와서, 어느 코드가 문제인지 찾느라 한참 헤맸다.
 */
describe("오류가 난 자리 뽑기", () => {
  const stack = [
    "TypeError: Cannot read properties of undefined (reading 'replace')",
    "    at grams (C:\\orak\\orak-food-reel-studio\\.next\\server\\chunks\\strategy.ts:128:20)",
    "    at bigramSimilarity (C:\\orak\\...\\strategy.ts:133:13)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
  ].join("\n");

  it("우리 코드의 파일 이름과 줄 번호만 뽑는다", () => {
    expect(codeLocation(stack)).toBe("strategy.ts:128");
  });

  it("전체 경로는 쓰지 않는다 (사용자 이름이 들어 있다)", () => {
    expect(codeLocation(stack)).not.toContain("C:");
    expect(codeLocation(stack)).not.toContain("orak-food-reel-studio");
  });

  it("라이브러리·노드 내부 줄은 건너뛴다", () => {
    const libFirst = [
      "TypeError: x",
      "    at Object.f (/app/node_modules/zod/lib/index.js:10:1)",
      "    at node:internal/process/task_queues:95:5",
      "    at run (/app/src/lib/pipeline/run.ts:250:9)",
    ].join("\n");
    expect(codeLocation(libFirst)).toBe("run.ts:250");
  });

  it("스택이 없거나 못 찾으면 빈 문자열", () => {
    expect(codeLocation(undefined)).toBe("");
    expect(codeLocation("TypeError: x")).toBe("");
    expect(codeLocation("at somewhere unknown")).toBe("");
  });
});

describe("프로그램 잘못인지 가리기", () => {
  it("코드가 터진 것은 프로그램 잘못", () => {
    expect(isProgramBug(new TypeError("x"))).toBe(true);
    expect(isProgramBug(new ReferenceError("x"))).toBe(true);
  });

  it("외부 API 오류는 자리 표시가 필요 없다", () => {
    // 이미 "요금제를 확인하세요" 처럼 무엇을 고칠지 알려주는 문구가 붙는다
    expect(isProgramBug(new Error("402 결제가 필요합니다"))).toBe(false);
    expect(isProgramBug("문자열 오류")).toBe(false);
    expect(isProgramBug(null)).toBe(false);
  });

  it("꼬리표는 프로그램 오류에만 붙는다", () => {
    const e = new TypeError("boom");
    e.stack = "TypeError: boom\n    at f (/app/src/lib/a.ts:7:1)";
    expect(bugTag(e)).toBe(" [프로그램 오류 · a.ts:7]");
    expect(bugTag(new Error("402"))).toBe("");
  });
});
