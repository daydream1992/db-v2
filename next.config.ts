import type { NextConfig } from "next";

const isStaticExport = process.env.BUILD_MODE === "export";

const nextConfig: NextConfig = {
  /* 静态导出模式：生成纯 HTML/CSS/JS，可直接浏览器打开，无需服务器/端口 */
  output: isStaticExport ? "export" : "standalone",
  /* 静态导出时图片不做服务端优化 */
  images: isStaticExport ? { unoptimized: true } : undefined,
  /* 静态导出时资源路径用相对路径，支持 file:// 协议直接打开 */
  assetPrefix: isStaticExport ? "./" : undefined,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
