import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: process.env.BASEPATH ?? '',
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
