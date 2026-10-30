import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Bundles the nightly catalog job (build.mjs), its parity check (parity.mjs) and the Pokémon set art dry run (set-art.mjs) into ESM files, run with `ELECTRON_RUN_AS_NODE=1 electron`
 * so it uses the repo's Electron-built better-sqlite3 (kept external with the other dependencies).
 */
export default defineConfig({
  root,
  resolve: { alias: { '@shared': `${root}src/shared` } },
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
        'set-art': `${root}scripts/catalog/setArtDryRun.ts`
      },
      output: { format: 'es', entryFileNames: '[name].mjs' }
    }
  }
})
