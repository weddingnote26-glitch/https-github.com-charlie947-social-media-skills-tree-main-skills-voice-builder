import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WASM/바이너리 패키지는 번들에 넣지 않고 그대로 실행
  serverExternalPackages: ["node-sqlite3-wasm", "ffmpeg-static", "ffprobe-static"],
  outputFileTracingIncludes: {
    "/**": ["./assets/**", "./sample/**", "./templates/**"],
  },
};

export default nextConfig;
