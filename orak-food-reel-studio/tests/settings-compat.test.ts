import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("settings-compat");
import { parseSettings } from "../src/lib/settings";

/**
 * 실제로 겪은 일: 새 판에서 imageProvider="cloudflare" 로 저장한 뒤
 * 옛 판으로 실행했더니 설정 검사가 통째로 실패해 제작이 0% 에서 멈췄다.
 * 설정값 하나가 낯설다고 프로그램 전체가 서면 안 된다.
 */
describe("낯선 설정값을 만나도 프로그램이 서지 않는다", () => {
  it("모르는 공급자는 기본값으로 되돌리고 나머지는 지킨다", () => {
    const s = parseSettings({
      imageProvider: "새로운공급자",   // 이 판이 모르는 값
      publishTime: "07:30",            // 이건 살아야 한다
      reelDurationSec: 30,
    });
    expect(s.imageProvider).toBe("sample");   // 기본값으로 복귀
    expect(s.publishTime).toBe("07:30");      // 나머지는 그대로
    expect(s.reelDurationSec).toBe(30);
  });

  it("중첩된 항목이 이상해도 그 항목만 되돌린다", () => {
    const s = parseSettings({
      publishTime: "09:15",
      imagePolicy: { fallback: true, reuseCache: true, costPolicy: "미래정책" },
    });
    expect(s.publishTime).toBe("09:15");
    expect(s.imagePolicy.costPolicy).toBe("cost_optimized");
    expect(s.imagePolicy.fallback).toBe(true);
  });

  it("여러 항목이 동시에 낯설어도 견딘다", () => {
    const s = parseSettings({
      imageProvider: "??", appMode: "??", approvalMode: "??",
      publishTime: "11:30",
    });
    expect(s.publishTime).toBe("11:30");
    expect(s.imageProvider).toBe("sample");
    expect(s.approvalMode).toBe("SAFE");
  });

  it("완전히 망가진 값이어도 기본값으로 시작한다 (예외를 던지지 않는다)", () => {
    expect(() => parseSettings("이건 설정이 아님")).not.toThrow();
    expect(() => parseSettings(null)).not.toThrow();
    expect(parseSettings(null).publishTime).toBeTruthy();
  });

  it("정상 설정은 손대지 않는다", () => {
    const s = parseSettings({ imageProvider: "cloudflare", publishTime: "08:00" });
    expect(s.imageProvider).toBe("cloudflare");
    expect(s.publishTime).toBe("08:00");
  });
});
