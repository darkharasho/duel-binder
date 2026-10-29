/**
 * Nightly catalog job: refreshes the card catalog into catalog-work/work.sqlite the way the
 * desktop app does, uploads what changed since catalog-work/base.sqlite (the last snapshot the
 * portal accepted), then makes work the new base.
 *
 *   npm run catalog:job [-- --full | --dry-run | --allow-shrink | --refresh-sets]
 *
 * Env: PORTAL_URL, PORTAL_ADMIN_TOKEN (not needed for --dry-run). --full ignores the base and
 * uploads every row; --dry-run refreshes and prints per-table counts without uploading or
 * touching the base. A refresh that would delete more than a sliver of any table (see
 * `findShrinks`) is refused unless --allow-shrink is passed, since every client applies the
 * deletes. --refresh-sets re-reads the non-English set lists now instead of on their weekly timer.
 * Problems that don't stop the upload (a failed card sync, a failed fingerprint build)
 * end the run with a non-zero exit so the workflow shows red. So does a fingerprint file that fails
 * the accuracy gate (see accuracy.ts), which is held back while clients keep the last one.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
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
import { accuracyProblem, checkAccuracy, type AccuracyReport } from './accuracy'
import { deletesByGame, diffTable, hasGameColumn } from './diff'
import { buildFingerprints, uploadFingerprints } from './fingerprints'
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
  yugipedia?: Pick<YugipediaClient, 'listPageImages' | 'fetchImageUrls'>
  /** Refreshes the work database; defaults to `refreshCatalog` against the live APIs. */
  refresh?: (work: Database.Database, onProblem: (p: string) => void) => Promise<unknown>
  /** Uploads deletes beyond the shrink limit. */
  allowShrink?: boolean
  /** Re-reads the non-English set lists now instead of waiting for their weekly timer. */
  refreshSets?: boolean
  /** Checks a new fingerprint file before it is uploaded; defaults to `checkAccuracy`. */
  checkAccuracy?: (work: Database.Database, bytes: Uint8Array) => Promise<AccuracyReport>
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

export async function runJob(opts: JobOptions): Promise<JobResult> {
  const log = opts.log ?? ((line: string): void => console.log(line))
  const { url, token } = opts
  const problems: string[] = []
  const problem = (p: string): void => {
    problems.push(p)
    log(`Problem: ${p}`)
  }
  if (!opts.dryRun && (!url || !token)) {
    throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set (or pass --dry-run)')
  }
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
  // The catalog is the job's main product, so a fingerprint failure never stops its upload; it
  // is reported as a problem instead.
  const fingerprint = async (upload: boolean): Promise<void> => {
    try {
      const out = await buildFingerprints({
        work,
        cachePath: join(opts.dir, 'fingerprints.sqlite'),
        fetch: opts.imageFetch ?? opts.fetch,
        log,
        references: {
          yugipedia: opts.yugipedia ?? createYugipediaClient({ version }),
          fetch: opts.imageFetch ?? opts.fetch,
          userAgent: `DuelBinder/${version} (https://github.com/darkharasho/duel-binder)`
        }
      })
      const refs = out.references
      log(`Fingerprints: ${out.count} (${out.fetched} new, ${out.failed} failed)`)
      log(`Printing scans: ${refs.count} (${refs.fetched} new, ${refs.failed} failed)`)
      const report = await (opts.checkAccuracy ?? checkAccuracy)(work, out.bytes)
      log(`Accuracy: ${report.right} of ${report.shots} shots right, ${report.wrong.length} wrong`)
      const failed = accuracyProblem(report)
      if (failed) {
        problem(`Fingerprints held back: ${failed}`)
        return
      }
      if (upload) {
        await uploadFingerprints({ url: url!, token: token!, bytes: out.bytes, fetch: opts.fetch })
      }
    } catch (e) {
      problem(`Fingerprints failed: ${e instanceof Error ? e.message : e}`)
    }
  }
  try {
    if (opts.refreshSets) deleteMeta(work, 'intl_sets_synced_at')
    await refresh(work, problem)
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
      await fingerprint(false)
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

    // Only now, with the portal holding this state, does work become the new base.
    base?.close()
    base = null
    rmSync(tmpPath, { force: true })
    work.prepare('VACUUM INTO ?').run(tmpPath)
    // A leftover WAL from an old base would be replayed onto the new file.
    rmSync(`${basePath}-wal`, { force: true })
    rmSync(`${basePath}-shm`, { force: true })
    renameSync(tmpPath, basePath)
    await fingerprint(true)
    return { counts: null, uploaded, problems }
  } finally {
    base?.close()
    work.close()
    rmSync(tmpPath, { force: true })
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flags = ['--full', '--dry-run', '--allow-shrink', '--refresh-sets']
  const unknown = args.filter((a) => !flags.includes(a))
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(' ')}`)
  const { problems } = await runJob({
    dir: resolve('catalog-work'),
    url: process.env['PORTAL_URL'],
    token: process.env['PORTAL_ADMIN_TOKEN'],
    full: args.includes('--full'),
    dryRun: args.includes('--dry-run'),
    allowShrink: args.includes('--allow-shrink'),
    refreshSets: args.includes('--refresh-sets')
  })
  for (const p of problems) console.log(`::error::${p}`)
  if (problems.length > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
