import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §3 업체 정보 저장 단추는 화면에 하나만 있어야 한다.
 *
 * 위아래 두 곳에 두었더니 어느 것을 눌러야 하는지 헷갈렸고,
 * 서로 다른 저장 경로를 타면 같은 업체가 두 번 등록될 위험도 있었다.
 */
const FORM = path.join(process.cwd(), "src", "components", "RestaurantForm.tsx");

describe("업체 정보 저장 단추", () => {
  const src = fs.readFileSync(FORM, "utf8");

  it("실제 저장 단추는 한 개뿐이다", () => {
    const saves = src.match(/💾 업체 정보 저장/g) ?? [];
    expect(saves).toHaveLength(1);
  });

  it("저장을 부르는 곳도 한 군데로 모여 있다", () => {
    // save() 를 호출하는 지점: 저장 단추 + 저장하고 영상 제작하기 두 개까지만
    const calls = src.match(/save\(\{?\s*(thenProduce[^)]*)?\}?\)/g) ?? [];
    expect(calls.length, calls.join(" / ")).toBeLessThanOrEqual(2);
    // PATCH 를 직접 부르는 곳은 save() 안 한 군데뿐이어야 한다
    expect((src.match(/method:\s*"PATCH"/g) ?? [])).toHaveLength(1);
  });

  it("저장 중에는 단추가 잠기고, 성공·실패 문구가 다르다", () => {
    expect(src).toContain("저장 중…");
    expect(src).toContain("업체 정보가 저장되었습니다");
    expect(src).toContain("업체 정보를 저장하지 못했습니다");
    // 어느 단계에서 멈췄는지 구분한다
    expect(src).toContain("업체 정보는 저장됐지만 영상 제작에 실패했습니다");
  });

  it("취소·초기화 단추가 함께 있다", () => {
    expect(src).toContain(">취소<");
    expect(src).toContain(">초기화<");
  });
});

describe("§1 버튼 이름", () => {
  it("예전 이름이 코드에 남아 있지 않다", () => {
    const roots = [path.join(process.cwd(), "src")];
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && fs.readFileSync(p, "utf8").includes("저장하고 영상 다시 만들기")) {
          hits.push(path.relative(process.cwd(), p));
        }
      }
    };
    roots.forEach(walk);
    expect(hits, hits.join(", ")).toEqual([]);
  });
});
