import { describe, it, expect } from "vitest";
import { stepView, jobProgress, overallProgress, stepCounts, type ProgressStep } from "../src/lib/pipeline/progress";

const step = (p: Partial<ProgressStep>): ProgressStep =>
  ({ key: "k", label: "단계", status: "대기중", progress: 0, ...p });

describe("stepView — 진행률을 지어내지 않는다", () => {
  it("셀 수 없는 단계는 숫자 대신 '처리 중'", () => {
    const v = stepView(step({ status: "진행중", progress: 0, indeterminate: true }));
    expect(v.text).toBe("처리 중…");
    expect(v.animated).toBe(true);
    // 흐르는 막대라 길이 자체는 의미가 없다 — 숫자를 읽히지 않는 것이 핵심
    expect(v.text).not.toMatch(/\d+%/);
  });

  it("셀 수 없는 단계라도 메시지가 있으면 그것을 보여준다", () => {
    const v = stepView(step({ status: "진행중", indeterminate: true, message: "AI에게 대본을 요청했습니다" }));
    expect(v.text).toBe("AI에게 대본을 요청했습니다");
    expect(v.text).not.toMatch(/\d+%/);
  });

  it("셀 수 있는 단계는 진행 중에 100%가 되지 않는다", () => {
    expect(stepView(step({ status: "진행중", progress: 100 })).text).toBe("99%");
    expect(stepView(step({ status: "진행중", progress: 100 })).barPct).toBe(99);
    expect(stepView(step({ status: "진행중", progress: 45 })).text).toBe("45%");
  });

  it("실제로 끝났을 때만 100%", () => {
    const v = stepView(step({ status: "완료", progress: 100 }));
    expect(v.barPct).toBe(100);
    expect(v.icon).toBe("✓");
  });

  it("대기·실패 상태를 구분해 보여준다", () => {
    expect(stepView(step({ status: "대기중" })).text).toBe("대기중");
    const fail = stepView(step({ status: "실패", progress: 40, message: "이미지 API 한도 초과" }));
    expect(fail.icon).toBe("✗");
    expect(fail.text).toBe("이미지 API 한도 초과");
    expect(fail.barPct).toBe(40); // 어디서 멈췄는지 남긴다
  });

  it("이상한 값이 와도 0~100 밖으로 나가지 않는다", () => {
    expect(stepView(step({ status: "진행중", progress: -5 })).barPct).toBe(0);
    expect(stepView(step({ status: "진행중", progress: NaN })).barPct).toBe(0);
  });
});

describe("jobProgress — 끝난 만큼만 센다", () => {
  const four = (...s: ProgressStep[]) => s;

  it("아무것도 안 했으면 0%", () => {
    expect(jobProgress(four(step({}), step({}), step({}), step({})))).toBe(0);
    expect(jobProgress([])).toBe(0);
  });

  it("절반이 끝나면 50%", () => {
    expect(jobProgress(four(
      step({ status: "완료" }), step({ status: "완료" }), step({}), step({}),
    ))).toBe(50);
  });

  it("진행률을 알 수 없는 단계는 완료 전까지 0으로 센다", () => {
    // 렌더링이 '처리 중'이어도 전체가 올라가면 안 된다 — 실제로 끝난 건 1개뿐
    const a = jobProgress(four(step({ status: "완료" }), step({ status: "진행중", indeterminate: true }), step({}), step({})));
    expect(a).toBe(25);
  });

  it("셀 수 있는 단계는 부분 반영한다", () => {
    const a = jobProgress(four(step({ status: "완료" }), step({ status: "진행중", progress: 50 }), step({}), step({})));
    expect(a).toBe(38); // (1 + 0.5) / 4
  });

  it("건너뛴 단계는 끝난 것으로 센다", () => {
    expect(jobProgress(four(step({ status: "완료" }), step({ status: "건너뜀" }), step({}), step({})))).toBe(50);
  });

  it("실패한 단계는 완료로 세지 않는다", () => {
    expect(jobProgress(four(step({ status: "완료" }), step({ status: "실패", progress: 90 }), step({}), step({})))).toBe(25);
  });

  it("전부 끝나야 100%", () => {
    expect(jobProgress(four(
      step({ status: "완료" }), step({ status: "완료" }), step({ status: "완료" }), step({ status: "완료" }),
    ))).toBe(100);
  });
});

describe("overallProgress — 여러 작업 동시 진행", () => {
  it("작업들의 평균", () => {
    const done = [step({ status: "완료" }), step({ status: "완료" })];
    const half = [step({ status: "완료" }), step({})];
    expect(overallProgress([done, half])).toBe(75);
  });
  it("작업이 없으면 0", () => {
    expect(overallProgress([])).toBe(0);
    expect(overallProgress([[]])).toBe(0);
  });
});

describe("stepCounts", () => {
  it("상태별 개수를 센다", () => {
    const c = stepCounts([step({ status: "완료" }), step({ status: "실패" }), step({}), step({})]);
    expect(c).toEqual({ 대기중: 2, 진행중: 0, 완료: 1, 실패: 1, 건너뜀: 0 });
  });
});
