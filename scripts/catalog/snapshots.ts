/**
 * Builds and uploads each game's catalog snapshot (see src/shared/catalogSnapshot.ts), the file a
 * desktop pulling the game for the first time imports instead of the whole change feed.
 *
 * For each game it does exactly what a desktop's first pull does, into a fresh database: import
 * the game's current snapshot from the portal (when there is one for this catalog shape), then
 * read the feed from its cursor. So the snapshots in R2 are this job's only memory, a night costs
 * the DO one day of changes, and the desktop's import code runs every night. Then it exports the
 * game, gzips it and uploads it, unless nothing changed since the last one.
 *
 *   npm run catalog:snapshots            Env: PORTAL_URL, PORTAL_ADMIN_TOKEN
 *
 * A game that fails is logged and the next one tried; exits 1 if any failed.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { createGzip } from 'node:zlib'
import { catalogCursorKey } from '../../src/main/catalog/apply'
import { pullGame } from '../../src/main/catalog/pull'
import { exportSnapshot } from '../../src/main/catalog/snapshot'
import { inProcessApplier } from '../../src/main/catalogApplier'
import { createCloudClient } from '../../src/main/cloud/client'
import { openDatabase } from '../../src/main/db/database'
import { getMeta } from '../../src/main/db/meta'
import { catalogShape, SNAPSHOT_GAMES } from '../../src/shared/catalogSnapshot'
import type { GameId } from '../../src/shared/games'
import { uploadSnapshot } from './snapshotUpload'

/**
 * A hash of the code that writes and reads a snapshot, kept in each manifest: when it changes, a
 * game is exported again even though its feed hasn't moved.
 */
const builderSources = import.meta.glob(
  ['../../src/main/catalog/snapshot.ts', '../../src/shared/catalogSnapshot.ts'],
  { query: '?raw', import: 'default', eager: true }
) as Record<string, string>
export const SNAPSHOT_BUILDER = createHash('sha256')
  .update(
    Object.keys(builderSources)
      .sort()
      .map((k) => builderSources[k])
      .join('\n')
  )
  .digest('hex')
  .slice(0, 12)

/** Whether the published snapshot is current to `cursor` and was made by this export code. */
export const snapshotUpToDate = (
  before: { cursor: number; builder?: string } | null,
  cursor: number
): boolean => !!before && before.cursor === cursor && before.builder === SNAPSHOT_BUILDER

const rmDb = (file: string): void => {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true })
}

async function buildGame(
  game: GameId,
  dir: string,
  portalUrl: string,
  token: string,
  log: (line: string) => void
): Promise<void> {
  const started = Date.now()
  const shape = catalogShape()
  const dbFile = join(dir, `snap-${game}.sqlite`)
  rmDb(dbFile)
  const db = openDatabase(dbFile)
  try {
    const client = createCloudClient({ baseUrl: portalUrl, token, timeoutMs: 120_000 })
    const before = await client.catalogSnapshot!(game, shape)
    log(`${game}: last snapshot ${before ? `at ${before.cursor}` : 'none for this shape'}`)
    await pullGame({
      db,
      client,
      game,
      applier: inProcessApplier(db),
      set: () => {},
      snapshotDir: join(dir, 'snap-dl')
    })
    const cursor = Number(getMeta(db, catalogCursorKey(game)))
    if (snapshotUpToDate(before, cursor)) {
      log(`${game}: unchanged at ${cursor}, nothing to upload`)
      return
    }
    const out = join(dir, `snap-${game}.out.sqlite`)
    const counts = exportSnapshot(db, game, out, { cursor, dbVersion: getMeta(db, 'db_version') })
    await pipeline(createReadStream(out), createGzip({ level: 9 }), createWriteStream(`${out}.gz`))
    rmSync(out, { force: true })
    const m = await uploadSnapshot({
      portalUrl,
      token,
      file: `${out}.gz`,
      manifest: {
        game,
        shape,
        cursor,
        dbVersion: getMeta(db, 'db_version'),
        builder: SNAPSHOT_BUILDER,
        builtAt: new Date().toISOString()
      }
    })
    rmSync(`${out}.gz`, { force: true })
    log(
      `${game}: uploaded ${m.key} (${(m.bytes / 1e6).toFixed(1)} MB, ${JSON.stringify(counts)}) in ${Math.round((Date.now() - started) / 1000)} s`
    )
  } finally {
    db.close()
    rmDb(dbFile)
  }
}

export async function buildSnapshots(opts: {
  dir: string
  portalUrl: string
  token: string
  log?: (line: string) => void
}): Promise<string[]> {
  const log = opts.log ?? ((line: string): void => console.log(line))
  await mkdir(opts.dir, { recursive: true })
  const failed: string[] = []
  for (const game of SNAPSHOT_GAMES) {
    try {
      await buildGame(game, opts.dir, opts.portalUrl, opts.token, log)
    } catch (e) {
      console.error(`${game}: snapshot failed`, e)
      failed.push(game)
    }
  }
  return failed
}

async function main(): Promise<void> {
  const portalUrl = process.env['PORTAL_URL']
  const token = process.env['PORTAL_ADMIN_TOKEN']
  if (!portalUrl || !token) throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set')
  const failed = await buildSnapshots({ dir: resolve('catalog-work'), portalUrl, token })
  for (const g of failed) console.log(`::error::Catalog snapshot of ${g} failed`)
  if (failed.length > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
