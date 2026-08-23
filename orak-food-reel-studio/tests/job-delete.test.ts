import { describe, it, expect, beforeEach } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("job-delete");
import { db } from "../src/lib/db";
import { listJobs, deleteJobs, deleteJobsByStatus, countJobs } from "../src/lib/pipeline/jobs";

function makeJob(id: string, status: string, error?: string) {
  db().prepare("INSERT INTO production_jobs (id, steps_json, status, error) VALUES (?,?,?,?)")
    .run(id, JSON.stringify([{ key: "script", label: "대본 생성", status: "실패", progress: 20 }]), status, error ?? null);
}

beforeEach(() => {
  db().prepare("DELETE FROM production_jobs").run();
});

describe("실패한 작업 목록", () => {
  it("상태로 걸러 온다", () => {
    makeJob("j1", "실패", "이미지 API 한도 초과");
    makeJob("j2", "실패");
    makeJob("j3", "진행중");
    expect(listJobs("실패")).toHaveLength(2);
    expect(countJobs("실패")).toBe(2);
    expect(countJobs("진행중")).toBe(1);
  });

  it("단계 정보를 풀어서 준다", () => {
    makeJob("j1", "실패");
    expect(listJobs("실패")[0].steps[0].label).toBe("대본 생성");
  });
});

describe("삭제", () => {
  it("고른 것만 지운다", () => {
    makeJob("j1", "실패"); makeJob("j2", "실패"); makeJob("j3", "실패");
    expect(deleteJobs(["j1", "j3"])).toBe(2);
    expect(listJobs("실패").map((j) => j.id)).toEqual(["j2"]);
  });

  it("실제 삭제 건수를 돌려준다 (0을 고정으로 주지 않는다)", () => {
    makeJob("j1", "실패");
    expect(deleteJobs(["j1"])).toBe(1);
  });

  it("이미 지워진 id 를 다시 지워도 오류가 아니다", () => {
    // 새로고침 후 같은 버튼을 두 번 눌러도 막히면 안 된다
    expect(deleteJobs(["없는작업"])).toBe(0);
    expect(deleteJobs([])).toBe(0);
    expect(deleteJobs(["", "  "])).toBe(0);
  });

  it("같은 id 가 여러 번 와도 한 번만 센다", () => {
    makeJob("j1", "실패");
    expect(deleteJobs(["j1", "j1", "j1"])).toBe(1);
  });

  it("진행 중인 작업은 지우지 않는다", () => {
    makeJob("running", "진행중");
    expect(deleteJobs(["running"])).toBe(0);
    expect(countJobs("진행중")).toBe(1);
  });

  it("실패 목록 전체 삭제는 실패한 것만 지운다", () => {
    makeJob("f1", "실패"); makeJob("f2", "실패");
    makeJob("r1", "진행중"); makeJob("d1", "완료");
    expect(deleteJobsByStatus("실패")).toBe(2);
    expect(countJobs("실패")).toBe(0);
    expect(countJobs("진행중")).toBe(1);
    expect(countJobs("완료")).toBe(1);
  });

  it("진행중을 통째로 지우라는 요청은 거부한다", () => {
    makeJob("r1", "진행중");
    expect(deleteJobsByStatus("진행중")).toBe(0);
    expect(countJobs("진행중")).toBe(1);
  });
});
