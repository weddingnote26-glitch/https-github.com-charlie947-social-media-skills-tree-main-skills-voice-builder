import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §12 보안 — 코드를 훑어 규칙이 깨졌는지 본다.
 *
 * 사람이 매번 눈으로 확인하는 대신, 규칙을 어기면 시험이 실패하게 한다.
 */
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const FILES = walk(path.join(ROOT, "src"));
const read = (f: string) => fs.readFileSync(f, "utf8");
const rel = (f: string) => path.relative(ROOT, f);

describe("§12 토큰이 새지 않는다", () => {
  it("브라우저 저장소에 토큰을 넣지 않는다", () => {
    const bad = FILES.filter((f) => /localStorage|sessionStorage/.test(read(f)));
    expect(bad.map(rel), "브라우저 저장소는 평문이다 — 토큰을 두면 안 된다").toEqual([]);
  });

  it("Authorization 헤더를 로그로 남기지 않는다", () => {
    const bad = FILES.filter((f) => {
      const src = read(f);
      return /log(Info|Warn|Error)\([^)]*[Aa]uthorization/.test(src);
    });
    expect(bad.map(rel)).toEqual([]);
  });

  it("바깥에서 온 오류 문구는 반드시 걸러서 내보낸다", () => {
    const src = read(path.join(ROOT, "src", "lib", "providers", "api-failure.ts"));
    // 외부 문구를 tail 로 붙이는 자리에는 redact 가 있어야 한다
    for (const line of src.split("\n").filter((l) => l.includes("const tail"))) {
      expect(line, `걸러지지 않은 외부 문구: ${line.trim()}`).toContain("redact(");
    }
  });

  it("소스에 진짜 키가 박혀 있지 않다", () => {
    const KEYS = [
      /\bsk-ant-[A-Za-z0-9_-]{20,}/, /\bsk-proj-[A-Za-z0-9_-]{20,}/,
      /\bAIza[A-Za-z0-9_-]{30,}/, /\bIGAA[A-Za-z0-9_-]{60,}/, /\bEAA[A-Za-z0-9]{60,}/,
    ];
    const bad: string[] = [];
    for (const f of FILES) {
      const src = read(f);
      if (/\.test\.tsx?$/.test(f)) continue;
      for (const re of KEYS) if (re.test(src)) bad.push(rel(f));
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it(".env 와 비밀 파일은 git 에 올리지 않는다", () => {
    const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    for (const must of [".env", "data/", "output/"]) {
      expect(ignore, `${must} 가 .gitignore 에 없다`).toContain(must);
    }
  });
});

describe("§7 실제 게시는 확인 없이 나가지 않는다", () => {
  it("발행 API 는 confirmed 없이는 게시하지 않는다", () => {
    const src = read(path.join(ROOT, "src", "app", "api", "reels", "[id]", "publish", "route.ts"));
    expect(src).toContain("confirmed");
    expect(src).toContain("최종 확인 후에만 발행할 수 있습니다");
    // publishNow 는 확인을 통과한 뒤에만 불려야 한다
    const afterCheck = src.slice(src.indexOf("최종 확인 후에만"));
    expect(afterCheck).toContain("publishNow(");
  });

  it("예약 목록의 [지금 발행]도 같은 확인을 거친다", () => {
    const src = read(path.join(ROOT, "src", "app", "api", "schedules", "route.ts"));
    expect(src).toContain("confirmed");
    expect(src).toContain("최종 확인 후에만 발행할 수 있습니다");
  });
});
