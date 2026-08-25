/** 클라우드 동기화 폴더 경고 — 알리기만 하고 절대 멈추지 않는다 */
import os from "node:os";
import { execSync } from "node:child_process";
import { checkCloudSync, cloudAdvice } from "./cloud-check.mjs";

function taskList() {
  if (os.platform() !== "win32") return "";
  try {
    return execSync("tasklist /fo csv /nh", { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return ""; // 회사 PC 에서 tasklist 가 막혀 있어도 그냥 넘어간다
  }
}

const dir = process.cwd();
const result = checkCloudSync({ dir, home: os.homedir(), platform: os.platform(), taskListOutput: taskList() });
const msg = cloudAdvice(result, dir);
if (msg) console.log(msg);
