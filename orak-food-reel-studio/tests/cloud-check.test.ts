import { describe, it, expect } from "vitest";
import { cloudFolderName, runningCloudApps, inUserProfile, checkCloudSync, cloudAdvice } from "../scripts/cloud-check.mjs";

/**
 * 실제로 겪은 일: 프로그램이 Documents 안에 있고 구글 드라이브가 그 폴더를
 * 제자리에서 동기화하고 있어서, 빌드가 EPERM 으로 멈췄다.
 * 경로에는 "Drive" 라는 낱말이 전혀 없었다 — 경로만 봐서는 절대 못 잡는다.
 */
describe("경로로 잡히는 경우", () => {
  it("서비스 폴더 안이면 이름을 돌려준다", () => {
    expect(cloudFolderName("C:\\Users\\나\\OneDrive\\프로젝트")).toBe("원드라이브");
    expect(cloudFolderName("G:\\내 드라이브\\프로젝트")).toBe("구글 드라이브");
    expect(cloudFolderName("C:\\Users\\나\\My Drive\\x")).toBe("구글 드라이브");
    expect(cloudFolderName("C:\\Users\\나\\Dropbox\\x")).toBe("드롭박스");
  });
  it("평범한 경로는 잡지 않는다", () => {
    expect(cloudFolderName("C:\\orak")).toBeNull();
    expect(cloudFolderName("C:\\Users\\USER\\Documents\\블로그작업")).toBeNull();
  });
});

describe("켜져 있는 프로그램으로 짐작하는 경우", () => {
  const drive = '"GoogleDriveFS.exe","1234","Console","1","300,000 K"';

  it("동기화 프로그램을 알아본다", () => {
    expect(runningCloudApps(drive)).toEqual(["구글 드라이브"]);
    expect(runningCloudApps('"OneDrive.exe","1","Console","1","1 K"')).toEqual(["원드라이브"]);
    expect(runningCloudApps('"chrome.exe","1","Console","1","1 K"')).toEqual([]);
    expect(runningCloudApps("")).toEqual([]);
  });

  it("개인 폴더 안인지 가린다", () => {
    expect(inUserProfile("C:\\Users\\USER\\Documents\\x", "C:\\Users\\USER")).toBe(true);
    expect(inUserProfile("C:\\orak", "C:\\Users\\USER")).toBe(false);
    expect(inUserProfile("C:\\Users\\USER2\\x", "C:\\Users\\USER")).toBe(false);
  });

  it("바로 그 상황 — Documents + 구글 드라이브 실행 중 → 짐작으로 알려준다", () => {
    const r = checkCloudSync({
      dir: "C:\\Users\\USER\\Documents\\블로그작업\\orak-food-reel-studio",
      home: "C:\\Users\\USER",
      platform: "win32",
      taskListOutput: drive,
    });
    expect(r.level).toBe("maybe");
    expect(r.service).toBe("구글 드라이브");
  });

  it("동기화 프로그램이 없으면 조용하다", () => {
    const r = checkCloudSync({
      dir: "C:\\Users\\USER\\Documents\\x", home: "C:\\Users\\USER",
      platform: "win32", taskListOutput: '"chrome.exe","1","Console","1","1 K"',
    });
    expect(r.level).toBe("none");
  });

  it("동기화 폴더 안이면 프로그램이 꺼져 있어도 확실하다고 본다", () => {
    const r = checkCloudSync({
      dir: "C:\\Users\\USER\\OneDrive\\x", home: "C:\\Users\\USER",
      platform: "win32", taskListOutput: "",
    });
    expect(r).toMatchObject({ level: "sure", service: "원드라이브" });
  });

  it("윈도우가 아니면 짐작하지 않는다", () => {
    const r = checkCloudSync({ dir: "/home/me/x", home: "/home/me", platform: "linux", taskListOutput: "" });
    expect(r.level).toBe("none");
  });
});

describe("안내문", () => {
  it("확실할 때와 짐작일 때 말투가 다르다", () => {
    const sure = cloudAdvice({ level: "sure", service: "원드라이브", apps: [] }, "C:\\x");
    expect(sure).toContain("동기화 폴더 안에 있습니다");
    expect(sure).toContain("동기화 일시 중지");
    expect(sure).toContain("C:\\orak");

    const maybe = cloudAdvice({ level: "maybe", service: "구글 드라이브", apps: ["구글 드라이브"] }, "C:\\x");
    // 짐작일 뿐이므로 단정하지 않는다
    expect(maybe).toContain("설정돼 있다면");
    expect(maybe).not.toContain("동기화 폴더 안에 있습니다");
  });

  it("문제 없으면 아무 말도 하지 않는다", () => {
    expect(cloudAdvice({ level: "none", service: null, apps: [] }, "C:\\x")).toBe("");
  });
});
