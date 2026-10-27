/**
 * Nightly catalog job: refreshes the card catalog into catalog-work/work.sqlite the way the
 * desktop app does, uploads what changed since catalog-work/base.sqlite (the last snapshot the
 * portal accepted), then makes work the new base.
 *
 *   npm run catalog:job [-- --full | --dry-run]
 *
 * Env: PORTAL_URL, PORTAL_ADMIN_TOKEN (not needed for --dry-run). --full ignores the base and
 * uploads every row; --dry-run refreshes and prints per-table counts without uploading or
 * touching the base.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type Database from 'better-sqlite3'
import { version } from '../../package.json'
import { openDatabase } from '../../src/main/db/database'
import { refreshCatalog } from '../../src/main/sync/catalog'
import { createYgoClient } from '../../src/main/ygo/client'
import { createYugipediaClient, type YugipediaClient } from '../../src/main/yugipedia/client'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import { diffTable } from './diff'
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
  refresh?: (work: Database.Database) => Promise<unknown>
  log?: (line: string) => void
}

export interface JobResult {
  /** Per-table change counts (dry run only). */
  counts: Record<string, { upserts: number; deletes: number }> | null
  uploaded: { upserted: number; deleted: number } | null
}

export async function runJob(opts: JobOptions): Promise<JobResult> {
  const log = opts.log ?? ((line: string): void => console.log(line))
  const { url, token } = opts
  if (!opts.dryRun && (!url || !token)) {
    throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set (or pass --dry-run)')
  }
  const refresh =
    opts.refresh ??
    ((work: Database.Database) =>
      refreshCatalog(work, {
        client: createYgoClient(),
        yugipedia: createYugipediaClient({ version }),
        version,
        tcgPrices: 'all',
        onSyncProgress: (s) => log(`Card sync: ${s.state}${s.error ? ` (${s.error})` : ''}`)
      }))

  mkdirSync(opts.dir, { recursive: true })
  const basePath = join(opts.dir, 'base.sqlite')
  const tmpPath = `${basePath}.tmp`
  const work = openDatabase(join(opts.dir, 'work.sqlite'))
  let base: Database.Database | null = null
  // The catalog is the job's main product, so a fingerprint failure is logged and never fails it.
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
      if (upload) {
        await uploadFingerprints({ url: url!, token: token!, bytes: out.bytes, fetch: opts.fetch })
      }
    } catch (e) {
      log(`Fingerprints failed: ${e instanceof Error ? e.message : e}`)
    }
  }
  try {
    await refresh(work)
    base = !opts.full && existsSync(basePath) ? openDatabase(basePath) : null
    log(base ? 'Diffing against the last uploaded snapshot' : 'No base snapshot: every row is new')

    if (opts.dryRun) {
      const counts: NonNullable<JobResult['counts']> = {}
      for (const t of CATALOG_TABLES) {
        const d = diffTable(work, base, t)
        counts[t.name] = { upserts: d.upserts.length, deletes: d.deletes.length }
        log(`${t.name}: ${d.upserts.length} upserts, ${d.deletes.length} deletes`)
      }
      await fingerprint(false)
      return { counts, uploaded: null }
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
    return { counts: null, uploaded }
  } finally {
    base?.close()
    work.close()
    rmSync(tmpPath, { force: true })
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a !== '--full' && a !== '--dry-run')
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(' ')}`)
  await runJob({
    dir: resolve('catalog-work'),
    url: process.env['PORTAL_URL'],
    token: process.env['PORTAL_ADMIN_TOKEN'],
    full: args.includes('--full'),
    dryRun: args.includes('--dry-run')
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
