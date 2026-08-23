import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 설치본은 node_modules 없이 혼자 돌아야 한다 → server.js 와 필요한 파일만 모아 준다
  output: "standalone",
  // WASM/바이너리 패키지는 번들에 넣지 않고 그대로 실행
  serverExternalPackages: ["node-sqlite3-wasm", "ffmpeg-static", "ffprobe-static"],
  outputFileTracingIncludes: {
    "/**": ["./assets/**", "./sample/**", "./templates/**"],
  },
};

export default nextConfig;
