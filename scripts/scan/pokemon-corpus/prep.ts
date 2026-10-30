/**
 * Builds what the Pokémon real-photo gate (tests/main/scan-pkm-real.test.ts) matches against,
 * in ~/scan-capture/pkm-work (outside the repo): catalog.sqlite, the full English and Japanese
 * Pokémon catalog the nightly job writes, and fingerprints-pkm.bin, the fingerprint file the job
 * would build from it. The whole catalog, so the photos meet the real distractors.
 *
 * Run from the repo root (bundled like the catalog job, so it gets the Electron-built
 * better-sqlite3):
 *   npx vite build --ssr scripts/scan/pokemon-corpus/prep.ts --outDir out/pkm-corpus --emptyOutDir
 *   npx cross-env ELECTRON_RUN_AS_NODE=1 electron out/pkm-corpus/prep.mjs [--out <dir>] [--no-refresh]
 *
 * Re-runnable: TCGdex and TCGCSV answers are cached in pokemon-src.sqlite and hashes in
 * fingerprints-pkm.sqlite, both next to the catalog, so a second run fetches only what's new.
 * --no-refresh keeps the catalog as it is and only (re)builds the fingerprint file.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { version } from '../../../package.json'
import { openDatabase } from '../../../src/main/db/database'
import { buildFingerprints } from '../../catalog/fingerprints'
import { runPokemonStep } from '../../catalog/pokemon'

const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const OUT = resolve(
  outArg >= 0 ? args[outArg + 1] : join(homedir(), 'scan-capture', 'pkm-work')
).replace(/^~/, homedir())
const REFRESH = !args.includes('--no-refresh')

const log = (line: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`)

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const started = Date.now()
  const work = openDatabase(join(OUT, 'catalog.sqlite'))
  try {
    if (REFRESH) {
      const { reports, error } = await runPokemonStep(work, {
        cachePath: join(OUT, 'pokemon-src.sqlite'),
        version,
        log
      })
      if (error !== null) throw new Error(`Pokémon refresh failed: ${error}`)
      for (const r of reports)
        log(
          `${r.lang}: ${r.sets} sets, ${r.cards} cards, ${r.versions} versions, ${r.images} images, ${r.unmatchedCards} unmatched`
        )
    }
    const count = (sql: string): number => (work.prepare(sql).pluck().get() as number) ?? 0
    log(
      `catalog: ${count("SELECT count(*) FROM cards WHERE game = 'pkm'")} cards, ${count("SELECT count(*) FROM card_printings WHERE game = 'pkm'")} versions, ${count("SELECT count(*) FROM card_images WHERE game = 'pkm'")} images`
    )
    // At the job's own concurrency; it logs only failures (progress shows in the cache's row count).
    const out = await buildFingerprints({
      work,
      game: 'pkm',
      cachePath: join(OUT, 'fingerprints-pkm.sqlite'),
      log
    })
    const file = join(OUT, 'fingerprints-pkm.bin')
    writeFileSync(file, out.bytes)
    log(
      `fingerprints: ${out.count} (${out.fetched} new, ${out.failed} failed), ${statSync(file).size} bytes in ${file}`
    )
    log(`done in ${Math.round((Date.now() - started) / 1000)} s`)
  } finally {
    work.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
