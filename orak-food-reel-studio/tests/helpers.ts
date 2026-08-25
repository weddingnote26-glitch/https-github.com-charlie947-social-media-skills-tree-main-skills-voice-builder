import fs from "node:fs";
import path from "node:path";

/** 각 테스트 파일마다 격리된 임시 DB */
export function useTempDb(tag: string): void {
  const dir = path.join(process.cwd(), ".test-tmp");
  fs.mkdirSync(dir, { recursive: true });
  process.env.ORAK_DB_PATH = path.join(dir, `test-${tag}-${Date.now()}.db`);
}
