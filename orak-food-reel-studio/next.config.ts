import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 등 네이티브 모듈은 서버 외부 패키지로 유지
  serverExternalPackages: ["better-sqlite3", "ffmpeg-static", "ffprobe-static"],
  outputFileTracingIncludes: {
    "/**": ["./assets/**", "./sample/**", "./templates/**"],
  },
};

export default nextConfig;
