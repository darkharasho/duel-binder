/**
 * Nightly catalog job: refreshes the card catalog into catalog-work/work.sqlite the way the
 * desktop app does, uploads what changed since catalog-work/base.sqlite (the last snapshot the
 * portal accepted), then makes work the new base.
 *
 *   npm run catalog:job [-- --full | --dry-run | --allow-shrink | --refresh-sets | --refresh-cards | --no-pokemon | --stage <name>]
 *
 * Env: PORTAL_URL, PORTAL_ADMIN_TOKEN (not needed for --dry-run). --full ignores the base and
 * uploads every row; --dry-run refreshes and prints per-table counts without uploading or
 * touching the base. A refresh that would delete more than a sliver of any table (see
 * `findShrinks`) is refused unless --allow-shrink is passed, since every client applies the
 * deletes. --no-pokemon skips the Pokémon step. --refresh-sets re-reads the non-English set lists now instead of on their weekly timer. --refresh-cards reads the YGOPRODeck card list now instead of on its daily timer.
 * Problems that don't stop the upload (a failed card sync, a failed fingerprint build)
 * end the run with a non-zero exit so the workflow shows red. So does a fingerprint file that fails
 * the accuracy gate (see accuracy.ts), which is held back while clients keep the last one. Each
 * game has its own fingerprint file and gate: Pokémon's is built after Yu-Gi-Oh's (not with
 * --no-pokemon, nor before the catalog has Pokémon cards) and held back on its own.
 *
 * --stage runs one stage of the job, which is how the workflow calls it: each stage is a step there,
 * and its problems fail the run at the end, after the other stages, as they do here.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type Database from 'better-sqlite3'
import { version } from '../../package.json'
import { openDatabase } from '../../src/main/db/database'
import { deleteMeta } from '../../src/main/db/meta'
import { refreshCatalog } from '../../src/main/sync/catalog'
import { createYgoClient } from '../../src/main/ygo/client'
import { createYugipediaClient, type YugipediaClient } from '../../src/main/yugipedia/client'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import type { GameId } from '../../src/shared/games/types'
import {
  accuracyProblem,
  checkAccuracy,
  FIXTURES_DIR,
  PKM_FIXTURES_DIR,
  type AccuracyReport
} from './accuracy'
import { deletesByGame, diffTable, hasGameColumn } from './diff'
import { runPokemonStep, type PokemonReport } from './pokemon'
import { refreshPokemonSetArt, shouldRefreshSetArt, warmSetArt } from './pokemon/setArt'
import { buildFingerprints, uploadFingerprintRefs, uploadFingerprints } from './fingerprints'
import { uploadCatalog } from './upload'

export interface JobOptions {
  /** Holds work.sqlite and base.sqlite. */
  dir: string
  url?: string
  token?: string
  full?: boolean
  dryRun?: boolean
  fetch?: typeof fetch
  /** Fetches card art and printing scans for fingerprints; defaults to `fetch`. */
  imageFetch?: typeof fetch
  /** Finds printing scans for fingerprints; defaults to the live Yugipedia API. */
  yugipedia?: Pick<YugipediaClient, 'listPageImages' | 'fetchImageUrls' | 'imageUrlsByPageId'>
  /** Refreshes the work database; defaults to `refreshCatalog` against the live APIs. */
  refresh?: (work: Database.Database, onProblem: (p: string) => void) => Promise<unknown>
  /**
   * Refreshes the Pokémon catalog in the work database; defaults to `runPokemonStep` over the live
   * sources, cached in pokemon-src.sqlite. A non-null `error` skips Pokémon for the night.
   */
  pokemon?: (work: Database.Database) => Promise<{ reports: PokemonReport[]; error: string | null }>
  /**
   * Asks the portal to mirror new Pokémon set art into R2 (see warmSetArt); defaults to
   * `warmSetArt` against the portal, one image a second.
   */
  warmSetArt?: typeof warmSetArt
  /** Runs one stage instead of them all (--stage): each is its own step in the workflow. */
  stage?: Stage
  /** Leaves the Pokémon step out (--no-pokemon). */
  skipPokemon?: boolean
  /** Uploads deletes beyond the shrink limit. */
  allowShrink?: boolean
  /** Re-reads the non-English set lists now instead of waiting for their weekly timer. */
  refreshSets?: boolean
  /** Reads the YGOPRODeck card list now instead of on its daily timer. */
  refreshCards?: boolean
  /**
   * Checks a game's new fingerprint file before it is uploaded; defaults to `checkAccuracy` on
   * the game's fixtures.
   */
  checkAccuracy?: (
    work: Database.Database,
    bytes: Uint8Array,
    game: GameId
  ) => Promise<AccuracyReport>
  log?: (line: string) => void
}

export interface JobResult {
  /** Per-table change counts (dry run only). */
  counts: Record<string, { upserts: number; deletes: number }> | null
  uploaded: { upserted: number; deleted: number } | null
  /** What went wrong without stopping the upload; the CLI exits non-zero when any are listed. */
  problems: string[]
}

/** Deletes allowed per table: whichever is larger. Upstream rarely removes more than a handful. */
export const SHRINK_MIN_ROWS = 50
export const SHRINK_SHARE = 0.02

/**
 * Tables whose diff against `base` deletes more rows of a game than the shrink limit allows. The
 * limit and the count are per game, so a game's rows can't hide in another game's headroom.
 */
export function findShrinks(work: Database.Database, base: Database.Database | null): string[] {
  if (!base) return []
  const out: string[] = []
  for (const t of CATALOG_TABLES) {
    const deletes = deletesByGame(work, base, t)
    for (const game of t.games) {
      const n = hasGameColumn(t)
        ? (
            base.prepare(`SELECT count(*) AS n FROM ${t.name} WHERE game = ?`).get(game) as {
              n: number
            }
          ).n
        : (base.prepare(`SELECT count(*) AS n FROM ${t.name}`).get() as { n: number }).n
      const lost = deletes[game] ?? 0
      if (lost > Math.max(SHRINK_MIN_ROWS, n * SHRINK_SHARE)) {
        out.push(`${t.name} (${game}) would lose ${lost} of ${n} rows`)
      }
    }
  }
  return out
}

const noArt = (r: PokemonReport): number =>
  Object.values(r.artMissing).reduce((a, b) => a + b, 0)

/**
 * Logs the Pokémon reports. Their problems (unmatched products, variants outside the version
 * table, upstream gaps) are data notes that recur every night, so they are logged, not raised as
 * job problems; only a skipped refresh fails the job.
 */
function logPokemon(reports: PokemonReport[], log: (line: string) => void): void {
  for (const r of reports) {
    log(
      `Pokémon ${r.lang}: ${r.sets} sets, ${r.cards} cards, ${r.versions} versions (${r.priced} priced, ${r.versions - r.priced} unpriced), ${r.images} images (${r.artFilled} from a checked product, ${r.artRemoved} wrong ones removed, ${noArt(r)} cards without), ${r.unmatchedCards} cards unmatched, ${r.unverified} with unverified finishes, ${r.englishNamed} named in English by species or name, ${r.japaneseNames} still in Japanese, ${r.problems.length} notes`
    )
    if (r.unmatchedSets.length > 0)
      log(`Pokémon ${r.lang}: unmatched sets: ${r.unmatchedSets.join(', ')}`)
    if (noArt(r) > 0) log(`Pokémon ${r.lang}: no art: ${JSON.stringify(r.artMissing)}`)
    for (const p of r.problems) log(`Pokémon ${r.lang}: ${p}`)
  }
}

/** Image keys of Pokémon set art in `work` that `base` lacks (every one when there is no base). */
export function newSetArtKeys(work: Database.Database, base: Database.Database | null): string[] {
  const keys = (db: Database.Database): string[] =>
    (
      db.prepare('SELECT DISTINCT image_key FROM pokemon_set_art ORDER BY image_key').all() as {
        image_key: string
      }[]
    ).map((r) => r.image_key)
  const old = new Set(base ? keys(base) : [])
  return keys(work).filter((k) => !old.has(k))
}

/** In run order. They hand over through the files in `dir`, so one can start where the last stopped. */
export const STAGES = ['ygo', 'pokemon', 'upload', 'fingerprints-ygo', 'fingerprints-pkm'] as const
export type Stage = (typeof STAGES)[number]

export async function runJob(opts: JobOptions): Promise<JobResult> {
  const log = opts.log ?? ((line: string): void => console.log(line))
  const { url, token } = opts
  const on = (s: Stage): boolean => !opts.stage || opts.stage === s
  const problems: string[] = []
  const problem = (p: string): void => {
    problems.push(p)
    log(`Problem: ${p}`)
  }
  if (!opts.dryRun && (!url || !token)) {
    throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set (or pass --dry-run)')
  }
  if (opts.dryRun && opts.stage) throw new Error('--dry-run runs every stage, so it takes no --stage')
  const refresh =
    opts.refresh ??
    ((work: Database.Database, onProblem: (p: string) => void) =>
      refreshCatalog(work, {
        client: createYgoClient(),
        yugipedia: createYugipediaClient({ version }),
        version,
        tcgPrices: 'all',
        onSyncProgress: (s) => {
          log(`Card sync: ${s.state}${s.error ? ` (${s.error})` : ''}`)
          if (s.state === 'error') onProblem(`Card sync failed: ${s.error ?? 'unknown error'}`)
        }
      }))

  mkdirSync(opts.dir, { recursive: true })
  const basePath = join(opts.dir, 'base.sqlite')
  const tmpPath = `${basePath}.tmp`
  const work = openDatabase(join(opts.dir, 'work.sqlite'))
  let base: Database.Database | null = null
  const gate =
    opts.checkAccuracy ??
    ((w: Database.Database, bytes: Uint8Array, game: GameId) =>
      checkAccuracy(w, bytes, game === 'pkm' ? PKM_FIXTURES_DIR : FIXTURES_DIR, game))
  // The catalog is the job's main product, so a fingerprint failure never stops its upload; it
  // is reported as a problem instead. Each game's file is gated and uploaded on its own.
  const fingerprint = async (upload: boolean, game: GameId): Promise<void> => {
    const pkm = game === 'pkm'
    const what = pkm ? 'Pokémon fingerprints' : 'Fingerprints'
    let refs: Uint8Array
    const yugipedia = opts.yugipedia ?? createYugipediaClient({ version })
    try {
      const out = await buildFingerprints({
        work,
        game,
        cachePath: join(opts.dir, pkm ? 'fingerprints-pkm.sqlite' : 'fingerprints.sqlite'),
        fetch: opts.imageFetch ?? opts.fetch,
        log,
        // Printing scans are Yu-Gi-Oh's only.
        ...(pkm
          ? {}
          : {
              tokenArt: yugipedia,
              references: {
                yugipedia,
                fetch: opts.imageFetch ?? opts.fetch,
                userAgent: `DuelBinder/${version} (https://github.com/darkharasho/duel-binder)`
              }
            })
      })
      const scans = out.references
      log(`${what}: ${out.count} (${out.fetched} new, ${out.failed} failed)`)
      if (!pkm) log(`Printing scans: ${scans.count} (${scans.fetched} new, ${scans.failed} failed)`)
      refs = out.refs
      const report = await gate(work, out.bytes, game)
      log(
        `${pkm ? 'Pokémon accuracy' : 'Accuracy'}: ${report.right} of ${report.shots} shots right, ${report.wrong.length} wrong`
      )
      for (const shot of report.wrong) log(`  Wrong: ${shot}`)
      const failed = accuracyProblem(report, game)
      if (failed) {
        problem(`${what} held back: ${failed}`)
        return
      }
      if (!upload) return
      await uploadFingerprints({
        url: url!,
        token: token!,
        bytes: out.bytes,
        game,
        fetch: opts.fetch
      })
    } catch (e) {
      problem(`${what} failed: ${e instanceof Error ? e.message : e}`)
      return
    }
    // Refs go with Yu-Gi-Oh's printing scans; Pokémon has none.
    if (pkm) return
    // After the file they go with: a client holding the other file just finds no refs in it.
    try {
      await uploadFingerprintRefs({ url: url!, token: token!, bytes: refs, fetch: opts.fetch })
    } catch (e) {
      problem(`Fingerprint refs failed: ${e instanceof Error ? e.message : e}`)
    }
  }
  /** Pokémon's file, once the catalog has Pokémon cards (and it isn't skipped). */
  const pokemonFingerprints = async (upload: boolean): Promise<void> => {
    if (opts.skipPokemon) return
    if (!work.prepare("SELECT 1 FROM card_images WHERE game = 'pkm' LIMIT 1").get()) {
      log('Pokémon fingerprints: no Pokémon cards yet')
      return
    }
    await fingerprint(upload, 'pkm')
  }
  try {
    if (on('ygo')) {
      if (opts.refreshSets) deleteMeta(work, 'intl_sets_synced_at')
      if (opts.refreshCards) deleteMeta(work, 'last_sync_at')
      await refresh(work, problem)
    }
    if (on('pokemon') && !opts.skipPokemon) {
      const step =
        opts.pokemon ??
        (async (w: Database.Database) => {
          const out = await runPokemonStep(w, {
            cachePath: join(opts.dir, 'pokemon-src.sqlite'),
            version,
            log
          })
          // Weekly; a source that fails keeps last week's rows and is asked again tomorrow.
          if (out.error === null && shouldRefreshSetArt(w, new Date())) {
            await refreshPokemonSetArt(w, { version, log })
          }
          return out
        })
      const out = await step(work)
      if (out.error !== null) problem(`Pokémon refresh skipped: ${out.error}`)
      logPokemon(out.reports, log)
    }
    if (opts.stage && !on('upload')) {
      if (on('fingerprints-ygo')) await fingerprint(true, 'ygo')
      if (on('fingerprints-pkm')) await pokemonFingerprints(true)
      return { counts: null, uploaded: null, problems }
    }
    base = !opts.full && existsSync(basePath) ? openDatabase(basePath) : null
    log(base ? 'Diffing against the last uploaded snapshot' : 'No base snapshot: every row is new')
    // --full has no base and sends no deletes, so there is nothing to check.
    const shrinks = findShrinks(work, base)
    for (const s of shrinks) log(`Shrink: ${s}`)
    if (shrinks.length > 0 && !opts.dryRun && !opts.allowShrink) {
      throw new Error(
        `Refusing to upload: ${shrinks.join('; ')}. Check the upstream data, then rerun with --allow-shrink if it is real.`
      )
    }

    if (opts.dryRun) {
      const counts: NonNullable<JobResult['counts']> = {}
      for (const t of CATALOG_TABLES) {
        const d = diffTable(work, base, t)
        const lost = deletesByGame(work, base, t)
        for (const game of t.games) {
          const name = t.games.length > 1 ? `${t.name}:${game}` : t.name
          const upserts = hasGameColumn(t)
            ? d.upserts.filter((r) => r['game'] === game).length
            : d.upserts.length
          counts[name] = { upserts, deletes: lost[game] ?? 0 }
          log(`${name}: ${upserts} upserts, ${lost[game] ?? 0} deletes`)
        }
      }
      await fingerprint(false, 'ygo')
      await pokemonFingerprints(false)
      return { counts, uploaded: null, problems }
    }

    const uploaded = await uploadCatalog({
      url: url!,
      token: token!,
      work,
      base,
      fetch: opts.fetch
    })
    log(`Uploaded ${uploaded.upserted} rows, deleted ${uploaded.deleted}`)
    // New Pokémon pack art is fetched into the portal's R2 now, slowly, not by clients' first views.
    const art = newSetArtKeys(work, base)
    if (art.length > 0) {
      const warmed = await (opts.warmSetArt ?? warmSetArt)({
        url: url!,
        token: token!,
        keys: art,
        fetch: opts.fetch
      })
      log(
        `Pokémon set art: ${warmed.stored} stored, ${warmed.cached} already stored, ${warmed.failed} failed`
      )
    }

    // Only now, with the portal holding this state, does work become the new base.
    base?.close()
    base = null
    rmSync(tmpPath, { force: true })
    work.prepare('VACUUM INTO ?').run(tmpPath)
    // A leftover WAL from an old base would be replayed onto the new file.
    rmSync(`${basePath}-wal`, { force: true })
    rmSync(`${basePath}-shm`, { force: true })
    renameSync(tmpPath, basePath)
    if (!opts.stage) {
      await fingerprint(true, 'ygo')
      await pokemonFingerprints(true)
    }
    return { counts: null, uploaded, problems }
  } finally {
    base?.close()
    work.close()
    rmSync(tmpPath, { force: true })
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flags = ['--full', '--dry-run', '--allow-shrink', '--refresh-sets', '--refresh-cards', '--no-pokemon']
  const at = args.indexOf('--stage')
  const stage = at < 0 ? undefined : (args.splice(at, 2)[1] as Stage)
  if (at >= 0 && !STAGES.includes(stage!)) throw new Error(`--stage takes one of: ${STAGES.join(' ')}`)
  const unknown = args.filter((a) => !flags.includes(a))
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(' ')}`)
  const { problems } = await runJob({
    dir: resolve('catalog-work'),
    url: process.env['PORTAL_URL'],
    token: process.env['PORTAL_ADMIN_TOKEN'],
    full: args.includes('--full'),
    dryRun: args.includes('--dry-run'),
    allowShrink: args.includes('--allow-shrink'),
    refreshSets: args.includes('--refresh-sets'),
    refreshCards: args.includes('--refresh-cards'),
    skipPokemon: args.includes('--no-pokemon'),
    stage
  })
  for (const p of problems) console.log(`::error::${p}`)
  if (problems.length === 0) return
  // A problem doesn't stop the stages after it: the workflow fails on it once they have all run.
  const env = stage && process.env['GITHUB_ENV']
  if (env) appendFileSync(env, 'CATALOG_PROBLEMS=1\n')
  else process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
