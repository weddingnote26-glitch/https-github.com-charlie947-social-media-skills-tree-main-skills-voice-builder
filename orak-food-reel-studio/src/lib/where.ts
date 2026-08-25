/**
 * 프로그램 오류(TypeError 등)가 난 자리를 짧게 뽑는다.
 *
 * 왜 필요한가: "Cannot read properties of undefined (reading 'replace')" 만
 * 보고는 어느 코드가 문제인지 알 수 없다. 실제로 이 한 줄 때문에 원인을
 * 찾느라 한참 헤맸다. 파일 이름과 줄 번호만 붙여도 바로 찾을 수 있다.
 *
 * 파일 이름과 줄 번호만 쓴다 — 전체 경로에는 사용자 이름이 들어 있고,
 * 스택 전체는 화면에 넣기엔 너무 길다.
 */

/** 우리 코드가 아닌 줄 (라이브러리·노드 내부) */
function isOurs(line: string): boolean {
  if (/node_modules|node:internal|node:[a-z]/.test(line)) return false;
  return /\.(ts|tsx|js|mjs|cjs):\d+/.test(line);
}

/** 스택에서 "파일이름:줄" 하나만 뽑는다. 못 찾으면 빈 문자열. */
export function codeLocation(stack: string | undefined): string {
  if (!stack) return "";
  for (const raw of stack.split("\n").slice(1)) {
    if (!isOurs(raw)) continue;
    // …/src/lib/pipeline/script.ts:88:20  →  script.ts:88
    const m = raw.match(/([^\s/\\()]+\.(?:ts|tsx|js|mjs|cjs)):(\d+)(?::\d+)?/);
    if (m) return `${m[1]}:${m[2]}`;
  }
  return "";
}

/**
 * 이 오류가 "프로그램 잘못" 인가?
 * 외부 API 응답(401·402 …)은 자리 표시가 필요 없다 — 이미 무엇을 고칠지 알려 준다.
 */
export function isProgramBug(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return ["TypeError", "ReferenceError", "SyntaxError", "RangeError"].includes(e.name);
}

/** 화면에 붙일 짧은 꼬리표 (프로그램 오류일 때만) */
export function bugTag(e: unknown): string {
  if (!isProgramBug(e)) return "";
  const at = codeLocation(e instanceof Error ? e.stack : undefined);
  return at ? ` [프로그램 오류 · ${at}]` : " [프로그램 오류]";
}
