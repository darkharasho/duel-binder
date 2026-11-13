import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

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
        '@shared': shared,
        // The trimmed OpenCV.js build (core + imgproc); the package stays for its types.
        '@techstark/opencv-js': resolve('vendor/opencv/opencv.js')
      }
    },
    // Contribute labels reuse the phone's capture code, which reads the app version from here.
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react(), tailwindcss()]
  }
})
