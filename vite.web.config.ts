import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The web build of the renderer, served by workers/portal at app.duelbinder.com/app/.
export default defineConfig({
  root: resolve('src/renderer'),
  base: '/app/',
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve('workers/portal/site/app'),
    emptyOutDir: true,
    rollupOptions: { input: resolve('src/renderer/web.html') }
  }
})
