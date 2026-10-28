import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Bundles the rarity corpus tools (extract.mjs, evaluate.mjs) into ESM files under out/rarity,
 * run with plain node: npx vite build --config scripts/scan/rarity/vite.config.ts
 */
export default defineConfig({
  root,
  resolve: { alias: { '@shared': `${root}src/shared` } },
  build: {
    ssr: true,
    outDir: `${root}out/rarity`,
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      input: {
        extract: `${root}scripts/scan/rarity/extract.ts`,
        evaluate: `${root}scripts/scan/rarity/evaluate.ts`,
        features: `${root}scripts/scan/rarity/features.ts`,
        'fit-surface': `${root}scripts/scan/rarity/fit-surface.ts`,
        // A local copy of the evaluation run against the code before the rarity work, when present.
        ...(existsSync(`${root}scripts/scan/rarity/evaluate-baseline.ts`)
          ? { 'evaluate-baseline': `${root}scripts/scan/rarity/evaluate-baseline.ts` }
          : {})
      },
      output: { format: 'es', entryFileNames: '[name].mjs' }
    }
  }
})
