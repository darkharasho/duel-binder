import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Bundles the nightly catalog job (build.mjs), its parity check (parity.mjs) and the Pokémon set art dry run (set-art.mjs) and the printing photos' small copies (thumbs.mjs) into ESM files, run with `ELECTRON_RUN_AS_NODE=1 electron`
 * so it uses the repo's Electron-built better-sqlite3 (kept external with the other dependencies).
 */
export default defineConfig({
  root,
  resolve: {
    alias: {
      '@shared': `${root}src/shared`,
      // The trimmed OpenCV.js build the apps ship (see electron.vite.config.ts).
      '@techstark/opencv-js': `${root}vendor/opencv/opencv.js`
    }
  },
  build: {
    ssr: true,
    outDir: `${root}out/catalog`,
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      input: {
        build: `${root}scripts/catalog/build.ts`,
        parity: `${root}scripts/catalog/parity.ts`,
        'set-art': `${root}scripts/catalog/setArtDryRun.ts`,
        thumbs: `${root}scripts/catalog/thumbs.ts`,
        'pull-training': `${root}scripts/scan/pull-training.ts`,
        'op-number-replay': `${root}scripts/scan/op-number-replay.ts`
      },
      output: { format: 'es', entryFileNames: '[name].mjs' }
    }
  }
})
