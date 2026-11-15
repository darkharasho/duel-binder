import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inProcessApplier } from '../../src/main/catalogApplier'
import { pullGame } from '../../src/main/catalog/pull'
import { catalogGames } from '../../src/main/catalog/service'
import { exportSnapshot } from '../../src/main/catalog/snapshot'
import type { CloudClient } from '../../src/main/cloud/client'
import { getMeta, setMeta } from '../../src/main/db/meta'
import type { CatalogChangesResponse } from '../../src/shared/catalogFeed'
import { catalogShape, snapshotFileKey, type SnapshotOffer } from '../../src/shared/catalogSnapshot'
import type { SyncStatus } from '../../src/shared/types'
import { seedMagic } from '../fixtures/magic'
import { seededDb } from './helpers'

const LATER_ID = 9_200_000_001
const CURSOR = 4321

let gz: Buffer
let offer: SnapshotOffer
let dir: string
let db: Database.Database

beforeEach(async () => {
  const source = await seededDb()
  seedMagic(source)
  const work = mkdtempSync(join(tmpdir(), 'snap-src-'))
  exportSnapshot(source, 'mtg', join(work, 'mtg.sqlite'), { cursor: CURSOR, dbVersion: 'v7' })
  gz = gzipSync(readFileSync(join(work, 'mtg.sqlite')))
  offer = {
    game: 'mtg',
    shape: catalogShape(),
    cursor: CURSOR,
    dbVersion: 'v7',
    bytes: gz.byteLength,
    sha256: createHash('sha256').update(gz).digest('hex'),
    builtAt: '2026-11-15T00:00:00.000Z',
    key: snapshotFileKey('mtg', catalogShape(), CURSOR),
    url: 'https://portal.test/api/catalog/snapshot-file/x?exp=1&sig=s'
  }
  dir = mkdtempSync(join(tmpdir(), 'snap-dl-'))
  db = await seededDb()
})

const laterPage = (since: number): CatalogChangesResponse => {
  const card = db.prepare("SELECT * FROM cards WHERE game = 'ygo' LIMIT 1").get() as Record<
    string,
    unknown
  >
  return {
    changes: [
      {
        seq: since + 1,
        table: 'cards',
        row: { ...card, id: LATER_ID, game: 'mtg', name: 'Later Card' } as never
      }
    ],
    cursor: since + 1,
    more: false,
    dbVersion: 'v8',
    latest: since + 1
  }
}

/** A portal stand-in: the offer (or none), the file with Range, and one feed page after `since`. */
function fakeClient(over: Partial<CloudClient> = {}): CloudClient & {
  feedSince: number[]
  ranges: (string | null)[]
} {
  const feedSince: number[] = []
  const ranges: (string | null)[] = []
  return {
    feedSince,
    ranges,
    catalogChanges: vi.fn(async (since: number) => {
      feedSince.push(since)
      return laterPage(since)
    }),
    catalogSnapshot: vi.fn(async () => offer),
    download: vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      const range = init?.headers?.range ?? null
      ranges.push(range)
      const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0
      return new Response(new Uint8Array(gz.subarray(from)), { status: range ? 206 : 200 })
    }),
    ...over
  } as unknown as CloudClient & { feedSince: number[]; ranges: (string | null)[] }
}

const pull = (client: CloudClient, snapshotDir: string | null = dir): Promise<void> => {
  const states: SyncStatus['state'][] = []
  return pullGame({
    db,
    client,
    game: 'mtg',
    applier: inProcessApplier(db),
    set: (s) => states.push(s),
    snapshotDir: snapshotDir ?? undefined
  })
}

const mtgCards = (): number =>
  (db.prepare("SELECT count(*) AS n FROM cards WHERE game = 'mtg'").get() as { n: number }).n

describe('pullGame with a snapshot', () => {
  it('a first pull imports the snapshot then reads the feed from its cursor', async () => {
    const client = fakeClient()
    await pull(client)
    expect(client.feedSince).toEqual([CURSOR])
    expect(db.prepare("SELECT name FROM cards WHERE name = 'Serra Angel'").get()).toBeDefined()
    expect(db.prepare('SELECT name FROM cards WHERE id = ?').get(LATER_ID)).toEqual({
      name: 'Later Card'
    })
    expect(getMeta(db, 'catalog_cursor:mtg')).toBe(String(CURSOR + 1))
    expect(readdirSync(dir)).toEqual([])
  })

  it('resumes a partial download', async () => {
    writeFileSync(join(dir, `mtg-${CURSOR}.sqlite.gz.part`), gz.subarray(0, 100))
    const client = fakeClient()
    await pull(client)
    expect(client.ranges).toEqual(['bytes=100-'])
    expect(db.prepare("SELECT 1 FROM cards WHERE name = 'Serra Angel'").get()).toBeDefined()
  })

  it('falls back to the feed on a bad checksum', async () => {
    offer = { ...offer, sha256: '0'.repeat(64) }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = fakeClient()
    await pull(client)
    expect(client.feedSince).toEqual([0])
    expect(getMeta(db, 'catalog_cursor:mtg')).toBe('1')
    expect(readdirSync(dir)).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('falls back when there is no snapshot for this shape', async () => {
    const client = fakeClient({ catalogSnapshot: vi.fn(async () => null) })
    await pull(client)
    expect(client.feedSince).toEqual([0])
    expect(client.download).not.toHaveBeenCalled()
  })

  it('does not use a snapshot for a game already pulled', async () => {
    setMeta(db, 'catalog_cursor:mtg', '77')
    const client = fakeClient()
    await pull(client)
    expect(client.catalogSnapshot).not.toHaveBeenCalled()
    expect(client.feedSince).toEqual([77])
  })

  it('does not use a snapshot without a snapshot folder, or for Yu-Gi-Oh!', async () => {
    const client = fakeClient()
    await pull(client, null)
    expect(client.catalogSnapshot).not.toHaveBeenCalled()
    const ygo = fakeClient()
    await pullGame({
      db,
      client: ygo,
      game: 'ygo',
      applier: inProcessApplier(db),
      set: () => {},
      snapshotDir: dir
    })
    expect(ygo.catalogSnapshot).not.toHaveBeenCalled()
  })

  it('skips the snapshot when the game was pulled meanwhile', async () => {
    const base = fakeClient()
    const client = fakeClient({
      download: vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
        setMeta(db, 'catalog_cursor:mtg', '55')
        return base.download!(url, init)
      })
    })
    await pull(client)
    expect(mtgCards()).toBe(1) // only the feed's card, none of the snapshot's
    expect(client.feedSince).toEqual([55])
    expect(readdirSync(dir)).toEqual([])
  })

  it('resumes an import left by a quit', async () => {
    // A finished download, then a quit before the import finished.
    const file = join(dir, `mtg-${CURSOR}.sqlite`)
    writeFileSync(file, gunzipSync(gz))
    setMeta(
      db,
      'catalog_snapshot:mtg',
      JSON.stringify({ cursor: CURSOR, file, dbVersion: 'v7', table: 'cards', after: -1 })
    )
    const client = fakeClient()
    await pull(client)
    expect(client.catalogSnapshot).not.toHaveBeenCalled()
    expect(db.prepare("SELECT 1 FROM cards WHERE name = 'Serra Angel'").get()).toBeDefined()
    expect(client.feedSince).toEqual([CURSOR])
    expect(existsSync(file)).toBe(false)
  })

  it('forgets an import whose file is gone and reads the feed', async () => {
    setMeta(
      db,
      'catalog_snapshot:mtg',
      JSON.stringify({
        cursor: CURSOR,
        file: join(dir, 'gone.sqlite'),
        dbVersion: null,
        table: 'cards',
        after: -1
      })
    )
    const client = fakeClient({ catalogSnapshot: vi.fn(async () => null) })
    await pull(client)
    expect(getMeta(db, 'catalog_snapshot:mtg')).toBeNull()
    expect(client.feedSince).toEqual([0])
  })
})

describe('catalogGames', () => {
  it('keeps a game whose snapshot import is under way', () => {
    setMeta(db, 'active_game', 'ygo')
    expect(catalogGames(db, ['ygo', 'mtg'])).toEqual(['ygo'])
    setMeta(
      db,
      'catalog_snapshot:mtg',
      JSON.stringify({ cursor: 1, file: 'x', dbVersion: null, table: 'cards', after: -1 })
    )
    expect(catalogGames(db, ['ygo', 'mtg'])).toEqual(['ygo', 'mtg'])
  })
})
