import fs from 'node:fs'
import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const novelPackagePath = fs.realpathSync(path.resolve(__dirname, 'node_modules/novel'))
const tippyEsmPath = path.resolve(novelPackagePath, '../tippy.js/dist/tippy.esm.js')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),

      // Novel 的预构建包依赖 Tippy 默认导出；测试环境固定走其 ESM 构建，避免 CJS namespace 被当成函数。
      'tippy.js': tippyEsmPath
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    server: {
      deps: {
        // Novel 单入口会加载 CSS module，浮动菜单还依赖 Tippy 的 ESM 默认导出，统一交给 Vite 转换。
        inline: ['novel', 'react-tweet', 'tippy.js', '@tiptap/react', '@tiptap/extension-bubble-menu']
      }
    }
  }
})
