/**
 * AI-Service-Center PM2 配置。
 *
 * 生产 release 通过 current 软链接切换；PM2 始终引用稳定路径，更新时无需改进程定义。
 */
const PROJECT_ROOT = '/root/dingstock/dingstock-performance'
const CURRENT_DIR = `${PROJECT_ROOT}/current`
const NODE_BIN = '/root/.nvm/versions/node/v22.23.1/bin/node'
const PUBLIC_ORIGIN = 'http://8.137.151.95'
const BASE_PATH = '/performance'

module.exports = {
  apps: [
    {
      name: 'dingstock-performance-backend',
      cwd: `${CURRENT_DIR}/backend`,
      script: 'dist/src/main.js',
      interpreter: NODE_BIN,
      env: {
        NODE_ENV: 'production'
      },
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '1G',
      time: true
    },
    {
      name: 'dingstock-performance-web',
      cwd: `${CURRENT_DIR}/web`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3002',
      interpreter: NODE_BIN,
      env: {
        NODE_ENV: 'production',
        BASEPATH: BASE_PATH,
        NEXT_PUBLIC_API_BASE_URL: `${PUBLIC_ORIGIN}${BASE_PATH}/backend`,
        NEXT_PUBLIC_APP_URL: `${PUBLIC_ORIGIN}${BASE_PATH}`
      },
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '1G',
      time: true
    }
  ]
}
