import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./paths";

type Level = "info" | "warn" | "error";

/** 구조화 로그: 콘솔 + /logs/app-YYYY-MM-DD.log (JSON Lines) */
export function log(level: Level, scope: string, message: string, extra?: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), level, scope, message, ...extra };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  try {
    fs.mkdirSync(DIRS.logs, { recursive: true });
    const file = path.join(DIRS.logs, `app-${entry.ts.slice(0, 10)}.log`);
    fs.appendFileSync(file, line + "\n");
  } catch {
    /* 로그 실패가 프로그램을 멈추면 안 됨 */
  }
}

export const logInfo = (scope: string, msg: string, extra?: Record<string, unknown>) => log("info", scope, msg, extra);
export const logWarn = (scope: string, msg: string, extra?: Record<string, unknown>) => log("warn", scope, msg, extra);
export const logError = (scope: string, msg: string, extra?: Record<string, unknown>) => log("error", scope, msg, extra);
