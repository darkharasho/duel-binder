import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Bundles the nightly catalog job into one ESM file, run with `ELECTRON_RUN_AS_NODE=1 electron`
 * so it uses the repo's Electron-built better-sqlite3 (kept external with the other dependencies).
 */
export default defineConfig({
  root,
  resolve: { alias: { '@shared': `${root}src/shared` } },
  build: {
    ssr: `${root}scripts/catalog/build.ts`,
    outDir: `${root}out/catalog`,
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'build.mjs' } }
  }
})
