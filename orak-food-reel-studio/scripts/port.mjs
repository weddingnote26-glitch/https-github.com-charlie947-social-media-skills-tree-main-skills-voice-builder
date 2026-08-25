/**
 * .env 의 APP_PORT 를 읽어 출력합니다 (없으면 3000).
 * start.bat 이 이 값을 PORT 환경변수로 넘겨 줍니다.
 * (배치 파일 안에 정규식을 직접 쓰면 ^ 같은 문자가 깨지므로 파일로 분리했습니다)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let port = 3000;
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/APP_PORT\s*=\s*(\d+)/);
    if (m) { port = parseInt(m[1], 10); break; }
  }
} catch { /* .env 가 없으면 기본값 */ }
if (!Number.isInteger(port) || port < 1 || port > 65535) port = 3000;
console.log(port);
