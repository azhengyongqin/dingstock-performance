import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: process.env.BASEPATH ?? '',

  // 客户端同源 Route Handler 也必须使用相同 basePath，避免子路径部署后请求站点根目录。
  env: { NEXT_PUBLIC_BASE_PATH: process.env.BASEPATH ?? '' },
  reactStrictMode: true,
  pageExtensions: ['js', 'jsx', 'ts', 'tsx'],
  redirects: async () => {
    return [
      // 根路径统一重定向到工作台
      {
        source: '/',
        destination: '/workbench',
        permanent: true
      }
    ]
  },
  allowedDevOrigins: ['192.168.27.92'],
};

export default nextConfig;
