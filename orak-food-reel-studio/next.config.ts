import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// 이 파일이 있는 폴더 = 프로그램의 뿌리.
// 정해 주지 않으면 Next 가 위쪽 폴더를 훑어 package-lock.json 을 찾아 뿌리를 짐작한다.
// 개인 폴더(C:\Users\나\)에 예전에 만들어진 package-lock.json 이 하나 있으면
// 그걸 뿌리로 잡을 뻔했다는 경고가 뜬다 — 짐작하지 않게 못 박는다.
const HERE = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: HERE },
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
