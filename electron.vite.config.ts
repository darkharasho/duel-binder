import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    define: { __MAC_SIGNED__: JSON.stringify(Boolean(process.env.CSC_LINK)) }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // sandboxed preloads can only require 'electron'; bundle everything else
    build: { externalizeDeps: { exclude: ['@electron-toolkit/preload'] } }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
