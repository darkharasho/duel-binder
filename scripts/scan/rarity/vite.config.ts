import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Bundles the rarity corpus tools into ESM files under out/rarity, run with plain node:
 * npx vite build --config scripts/scan/rarity/vite.config.ts
 *
 * The pipeline: make-items.mjs lists a source's labelled cards; extract.mjs finds and straightens
 * them (optionally through synthetic camera conditions); evaluate.mjs scores the name and frame
 * rules on them; dump.mjs measures the rules' cues and the look model's features once, for
 * fit-look.mjs to fit and evaluate the look model by held-out card; bench.mjs times the per-frame
 * work. fit-surface.mjs refits the frame model.
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
        dump: `${root}scripts/scan/rarity/dump.ts`,
        bench: `${root}scripts/scan/rarity/bench.ts`,
        'fit-look': `${root}scripts/scan/rarity/fit-look.ts`,
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
