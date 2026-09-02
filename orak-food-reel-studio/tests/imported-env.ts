import fs from "node:fs";
import path from "node:path";

/**
 * 외부 영상 시험의 작업 자리.
 *
 * paths.ts 는 불러오는 순간 ORAK_HOME / ORAK_OUTPUT_DIR 을 읽어 굳힌다. 시험 파일의 import 는
 * 본문보다 먼저 실행되므로(hoisting) 본문에서 env 를 바꾸면 이미 늦다 — 실제로 첫 시험이
 * 프로젝트의 output/ 폴더에 결과를 썼다. 그래서 이 모듈을 시험 파일의 맨 첫 import 로 둔다.
 */
export const WORK = path.join(process.cwd(), ".test-tmp", `imported-${Date.now()}-${process.pid}`);
fs.mkdirSync(WORK, { recursive: true });
process.env.ORAK_DB_PATH = path.join(WORK, "test.db");
process.env.ORAK_HOME = path.join(WORK, "home");
process.env.ORAK_OUTPUT_DIR = path.join(WORK, "output");
