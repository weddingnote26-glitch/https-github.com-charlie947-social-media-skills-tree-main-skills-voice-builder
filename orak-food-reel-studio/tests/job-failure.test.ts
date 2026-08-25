import { describe, it, expect } from "vitest";
import { useTempDb } from "./helpers";
useTempDb("jobfail");
import { db } from "../src/lib/db";
import { createJob, getJob, runProductionJob } from "../src/lib/pipeline/run";

describe("대본 생성 실패 시 FOREIGN KEY 오류 없이 실패가 기록된다", () => {
  it("릴스 행이 없는 상태에서도 작업이 '실패'로 저장된다", async () => {
    const jobId = createJob();
    // 맛집명 없이 호출 → 조사 단계에서 실패 (reels 행이 만들어지기 전)
    await expect(runProductionJob(jobId, { restaurantName: "" })).rejects.toThrow();

    const job = getJob(jobId)!;
    expect(job.status).toBe("실패");
    expect(job.error).toBeTruthy();
    // 예전에는 여기서 FOREIGN KEY constraint failed 가 나서 기록조차 안 남았다
    expect(job.error).not.toContain("FOREIGN KEY");
    expect(job.reel_id).toBeNull();

    const failedStep = job.steps.find((s) => s.status === "실패");
    expect(failedStep?.key).toBe("research");
  });
});
