import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * 실제로 겪은 일: 설정 화면과 오락이 화면이 "불러오는 중…" 에서 멈춰 있었다.
 * 서버가 오류를 돌려줘도 화면은 로딩 문구만 보여 줘서, 사용자도 개발자도
 * 무엇이 잘못됐는지 볼 수 없었다.
 *
 * 화면을 띄우지 않고도 "오류를 감추는 화면" 을 잡아내는 시험이다.
 */
const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("화면이 오류를 로딩 문구 뒤에 숨기지 않는다", () => {
  const files = [...tsxFiles(path.join(ROOT, "src", "app")), ...tsxFiles(path.join(ROOT, "src", "components"))];

  it("useApi 를 쓰는 화면은 오류도 함께 처리한다", () => {
    const guilty: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (!/useApi</.test(src)) continue;
      if (!/불러오는 중/.test(src)) continue;          // 로딩 문구가 없으면 대상 아님
      const handles =
        /LoadGate/.test(src) ||                          // 공용 처리기를 쓰거나
        /if \(\s*error\b/.test(src) ||                   // 직접 error 로 갈라 보거나
        /error \?\?|error &&/.test(src);                  // 오류 문구를 화면에 내보내거나
      if (!handles) guilty.push(path.relative(ROOT, f));
    }
    expect(guilty, `오류를 "불러오는 중…" 뒤에 숨기는 화면:\n  ${guilty.join("\n  ")}`).toEqual([]);
  });

  it("LoadGate 는 오류 문구와 다시 시도 단추를 함께 보여 준다", () => {
    const ui = fs.readFileSync(path.join(ROOT, "src", "components", "ui.tsx"), "utf8");
    const gate = ui.slice(ui.indexOf("export function LoadGate"), ui.indexOf("export function ErrorBox"));
    expect(gate).toContain("불러오지 못했습니다");
    expect(gate).toContain("{error}");                 // 원문 오류를 그대로 보여 준다
    expect(gate).toContain("다시 시도");
    expect(gate).toContain("app-날짜.log");            // 어디를 보면 되는지까지
    expect(gate).toContain("응답이 오래 걸리고");        // 멈춘 요청도 알려 준다
  });
});
