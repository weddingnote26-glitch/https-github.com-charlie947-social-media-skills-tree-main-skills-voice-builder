import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// 이 파일이 있는 폴더 = 프로그램의 뿌리.
// 정해 주지 않으면 Next 가 위쪽 폴더를 훑어 package-lock.json 을 찾아 뿌리를 짐작한다.
// 개인 폴더(C:\Users\나\)에 예전에 만들어진 package-lock.json 이 하나 있으면
// 그걸 뿌리로 잡을 뻔했다는 경고가 뜬다 — 짐작하지 않게 못 박는다.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 지금 도는 프로그램이 언제 만든 것인지 화면에 적어 둔다.
 *
 * 업데이트를 했는데도 옛 화면이 보이는 일이 반복됐다. 설치본과 폴더 실행이
 * 서로 다른 빌드일 수 있어서, 눈으로는 구분할 방법이 없었다.
 * 빌드하는 순간의 날짜와 커밋을 박아 두면 한 번에 알 수 있다.
 */
function buildStamp(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha ? `${when} · ${sha}` : when;
  } catch {
    return when; // git 이 없어도 날짜만은 남는다
  }
}

const nextConfig: NextConfig = {
  turbopack: { root: HERE },
  env: { ORAK_BUILD: buildStamp() },
  // 설치본은 node_modules 없이 혼자 돌아야 한다 → server.js 와 필요한 파일만 모아 준다
  output: "standalone",
  // WASM/바이너리 패키지는 번들에 넣지 않고 그대로 실행
  serverExternalPackages: ["node-sqlite3-wasm", "ffmpeg-static", "ffprobe-static"],
  outputFileTracingIncludes: {
    "/**": ["./assets/**", "./sample/**", "./templates/**"],
  },
  // 지난 빌드 결과를 다시 담으면 standalone 이 자기 자신을 품는다
  outputFileTracingExcludes: {
    "/**": ["./dist-app/**", "./dist-bin/**", "./dist-installer/**", "./.next/standalone/**"],
  },
};

export default nextConfig;
