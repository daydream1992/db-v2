import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Turbopack 必须以 dataops-ui 为 root，否则检测到父目录 K:\DB数据库_v2\bun.lock
  // 会把整个父项目当 workspace 去爬（含 DuckDB 大文件），dev server 首次请求卡死/OOM
  turbopack: {
    root: path.resolve(__dirname),
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
};

export default nextConfig;
