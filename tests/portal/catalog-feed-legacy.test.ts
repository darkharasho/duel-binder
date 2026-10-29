import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import type { CatalogChangesResponse } from '../../src/shared/catalogFeed'
import { addUser, seededServerDb, memoryBucket, noPrintingArt } from './helpers'
import { seedPokemon, SHARED_SET_NAME } from '../fixtures/pokemon'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

/**
 * The legacy feed (no `game`, what v0.20 clients ask for), as raw response bodies over the Yu-Gi-Oh!
 * fixtures: a snapshot, a paged snapshot, and a delta with tombstones. The snapshot file was
 * captured before the feed became per-game; it must never change.
 */
export async function legacyFeedBodies(
  db: Database.Database,
  afterYgo?: () => Promise<void>
): Promise<string[]> {
  const alice = addUser(db, '1', 'alice')
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(
    sha256Hex('alice-desktop-token'),
    alice,
    'desktop',
    NOW.toISOString(),
    '2099-01-01T00:00:00.000Z'
  )
  const deps = {
    db,
    images: memoryBucket(),
    printingArt: noPrintingArt,
    prices: { soon: async () => {} },
    env: {},
    now: () => NOW,
    fetch: (async () => new Response('', { status: 404 })) as typeof fetch
  } as unknown as AppDeps
  const get = async (qs: string): Promise<string> => {
    const res = await handle(
      new Request(`${BASE}/api/catalog/changes${qs}`, {
        headers: { authorization: 'Bearer alice-desktop-token' }
      }),
      deps
    )
    expect(res.status).toBe(200)
    return res.text()
  }

  const card = db.prepare('SELECT id FROM cards ORDER BY id LIMIT 1').get() as { id: number }
  const printing = db.prepare('SELECT id FROM card_printings ORDER BY id LIMIT 1').get() as {
    id: number
  }
  const base = (db.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }).seq
  db.prepare("UPDATE cards SET name = 'Renamed' WHERE id = ?").run(card.id)
  db.prepare("UPDATE card_printings SET set_price = '9.99' WHERE id = ?").run(printing.id)
  db.prepare(
    "INSERT INTO sets (language, set_name, set_code) VALUES ('en', 'Doomed Set', 'DS')"
  ).run()
  db.prepare(
    "INSERT INTO sets (language, set_name, set_code) VALUES ('de', 'Kept Set', 'KS')"
  ).run()
  db.prepare("DELETE FROM sets WHERE set_name = 'Doomed Set'").run()
  await afterYgo?.()

  const bodies: string[] = []
  bodies.push(await get('?since=0'))
  let since = 0
  for (;;) {
    const body = await get(`?since=${since}&limit=7`)
    bodies.push(body)
    const page = JSON.parse(body) as CatalogChangesResponse
    since = page.cursor
    if (!page.more) break
  }
  bodies.push(await get(`?since=${base}`))
  bodies.push(await get(`?since=${base}&tables=sets,cards`))
  return bodies
}

describe('legacy catalog feed', () => {
  it('is byte-identical to the feed before games', async () => {
    const bodies = await legacyFeedBodies(await seededServerDb())
    await expect(bodies.join('\n') + '\n').toMatchFileSnapshot('fixtures/legacy-catalog-feed.txt')
  })
})

describe('legacy catalog feed with Pokémon in the catalog', () => {
  it('is unchanged but for the clock, whatever Pokémon rows and deletes come after', async () => {
    const db = await seededServerDb()
    const bodies = await legacyFeedBodies(db, async () => {
      seedPokemon(db)
      db.prepare(
        "INSERT INTO sets (game, language, set_name, set_code) VALUES ('pkm', 'en', 'Doomed Set', 'DS')"
      ).run()
      db.prepare("DELETE FROM sets WHERE game = 'pkm' AND set_name = 'Doomed Set'").run()
      db.prepare("DELETE FROM sets WHERE game = 'pkm' AND set_name = ?").run(SHARED_SET_NAME)
      db.prepare(
        'DELETE FROM pokemon_cards WHERE rowid = (SELECT MIN(rowid) FROM pokemon_cards)'
      ).run()
    })
    const snapshot = readFileSync(join(__dirname, 'fixtures/legacy-catalog-feed.txt'), 'utf8')
      .trimEnd()
      .split('\n')
    const withoutClock = (body: string): unknown => {
      const page: Partial<CatalogChangesResponse> = JSON.parse(body)
      delete page.latest
      return page
    }
    expect(bodies.map(withoutClock)).toEqual(snapshot.map(withoutClock))
    for (const b of bodies) expect(b).not.toContain('"game"')
  })
})
