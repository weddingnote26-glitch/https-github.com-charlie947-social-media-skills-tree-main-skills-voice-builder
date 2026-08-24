import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
