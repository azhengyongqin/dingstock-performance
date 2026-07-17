import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    server: {
      deps: {
        // Novel 的单入口会加载 react-tweet CSS module，需交给 Vite 转换后再进入 jsdom。
        inline: ['novel', 'react-tweet']
      }
    }
  }
})
