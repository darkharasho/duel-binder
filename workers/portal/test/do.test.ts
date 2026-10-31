import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { doSql } from '../src/doSql'
import type { SqlDb } from '../../../src/main/db/sql'
import { searchCards } from '../../../src/main/repo/cards'
import { countCandidates, priceCandidates } from '../../../src/main/prices/candidates'
import { requestPrices } from '../src/priceRequests'
import { assignSweep, refreshSweepQueue } from '../src/sweep'
import { assignPokemonSweep, refreshPokemonQueue } from '../src/pokemonSweep'

/** Run `fn` against a fresh, migrated Store's SQLite through the doSql adapter. */
function inStore<R>(name: string, fn: (db: SqlDb) => R): Promise<R> {
  const stub = env.STORE.get(env.STORE.idFromName(name))
  return runInDurableObject(stub, (_instance, state) => fn(doSql(state.storage)))
}

const insertCard = (db: SqlDb, id: number, name: string): void => {
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, ?, 'Normal Monster', 'normal', 'Dragon', '', '2026-10-24')`
  ).run(id, name)
}

describe('Store Durable Object SQLite', () => {
  it('all desktop + server migrations apply on DO SQLite', async () => {
    const names = await inStore('migrations', (db) =>
      (db.prepare('SELECT name FROM server_migrations').all() as { name: string }[]).map(
        (r) => r.name
      )
    )
    expect(names).toContain('desktop-10')
    expect(names).toContain('desktop-12')
    expect(names).toContain('server-1')
    expect(names).toContain('server-2')
  })

  it('FTS5 works', async () => {
    const hits = await inStore('fts', (db) => {
      insertCard(db, 89631139, 'Blue-Eyes White Dragon')
      db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
      return searchCards(db, 'blue')
    })
    expect(hits.map((h) => h.id)).toContain(89631139)
  })

  it('nested transaction rolls back as one unit', async () => {
    const ids = await inStore('nested', (db) => {
      const outer = db.transaction(() => {
        insertCard(db, 1, 'A')
        db.transaction(() => insertCard(db, 2, 'B'))()
        throw new Error('x')
      })
      expect(() => outer()).toThrow('x')
      return (db.prepare('SELECT id FROM cards WHERE id IN (1, 2)').all() as { id: number }[]).map(
        (r) => r.id
      )
    })
    expect(ids).toEqual([])
  })

  it('lastInsertRowid is the inserted id', async () => {
    const result = await inStore('rowid', (db) => {
      const info = db
        .prepare(
          "INSERT INTO users (discord_id, username, created_at, updated_at) VALUES (?, ?, 'now', 'now')"
        )
        .run('d-1', 'kaiba')
      const row = db.prepare('SELECT id FROM users WHERE discord_id = ?').get('d-1') as {
        id: number
      }
      return { lastInsertRowid: Number(info.lastInsertRowid), id: row.id, changes: info.changes }
    })
    expect(result.lastInsertRowid).toBe(result.id)
    expect(result.changes).toBe(1)
  })

  it('next-seq update runs on DO', async () => {
    const seqs = await inStore('next-seq', (db) => {
      insertCard(db, 1, 'A')
      db.exec(`
        INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (1, 'd1', 'one', 'x', 'x');
        INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity) VALUES (7, 1, 'S', 'S-001', 'Rare');
        INSERT INTO card_images (image_id, card_id, sort_order) VALUES (1, 1, 0);
        INSERT INTO collection_entries (id, user_id, uid, printing_id, image_id, quantity, created_at, updated_at, server_seq)
          VALUES (1, 1, 'a', 7, 1, 1, 'x', 'x', 5);
      `)
      const seq = (): number =>
        (db.prepare('SELECT server_seq FROM collection_entries WHERE id = 1').get() as { server_seq: number })
          .server_seq
      const before = seq()
      db.prepare(
        'UPDATE collection_entries SET server_seq = (SELECT COALESCE(MAX(server_seq), 0) + 1 FROM collection_entries) WHERE id = ?'
      ).run(1)
      return { before, after: seq() }
    })
    expect(seqs).toEqual({ before: 5, after: 6 })
  })

  it('price requests and the candidate query run on DO', async () => {
    const out = await inStore('price-requests', (db) => {
      insertCard(db, 1, 'A')
      db.exec(`
        INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (1, 'd1', 'one', 'x', 'x');
        INSERT INTO card_printings (id, card_id, language, set_name, set_code, set_rarity)
          VALUES (7, 1, 'ja', 'S', 'S-JP001', 'Rare'), (8, 1, 'ja', 'S', 'S-JP002', 'Rare');
        INSERT INTO card_images (image_id, card_id, sort_order) VALUES (1, 1, 0);
        INSERT INTO collection_entries (id, user_id, uid, printing_id, image_id, quantity, created_at, updated_at, server_seq)
          VALUES (1, 1, 'a', 8, 1, 1, 'x', 'x', 1);
      `)
      const pkey = (db.prepare('SELECT pkey FROM card_printings WHERE id = 7').get() as { pkey: string })
        .pkey
      const now = new Date('2026-10-24T12:00:00.000Z')
      const first = requestPrices(db, 1, [pkey], now)
      const again = requestPrices(db, 1, [pkey], now)
      return {
        first,
        again,
        candidates: priceCandidates(db, now).map((c) => c.id),
        count: countCandidates(db, now)
      }
    })
    expect(out).toEqual({
      first: { queued: 1, capped: false },
      again: { queued: 0, capped: false },
      candidates: [8, 7],
      count: 2
    })
  })

  it('the set sweep queue and assignment run on DO SQLite', async () => {
    const out = await inStore('sweep', (db) => {
      insertCard(db, 1, 'A')
      const add = (code: string, rarity: string, lang: string): void => {
        db.prepare(
          `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (1, 'Set', ?, ?, ?)`
        ).run(code, rarity, lang)
      }
      add('CORI-JP001', 'Ultra Rare', 'ja')
      add('CORI-JP001', 'Secret Rare', 'ja')
      add('CORI-JP002', 'Common', 'ja')
      add('CORI-DE001', 'Common', 'de')
      const now = new Date('2026-10-28T12:00:00.000Z')
      const listed = refreshSweepQueue(db, now)
      const again = refreshSweepQueue(db, now)
      const res = assignSweep(
        db,
        'CORI-JP',
        'ja',
        {
          codes: {
            'CORI-JP001': { all: { price: 9, listingCount: 4 }, byRarity: { 'Ultra Rare': { price: 7, listingCount: 3 } } },
            'CORI-JP002': { all: { price: 1, listingCount: 2 }, byRarity: {} }
          },
          calls: 2,
          checkedAt: now.toISOString()
        },
        now
      )
      const prices = db.prepare('SELECT price, price_seq FROM intl_prices ORDER BY price').all() as { price: number; price_seq: number }[]
      const sweep = db.prepare('SELECT key, language, swept_at, calls FROM price_sweeps').all()
      return { listed, again, res, prices, sweep }
    })
    expect(out.listed).toBe(1)
    expect(out.again).toBe(0)
    expect(out.res).toEqual({ priced: 2, skipped: 1 })
    expect(out.prices.map((p) => p.price)).toEqual([1, 7])
    expect(out.prices.every((p) => p.price_seq > 0)).toBe(true)
    expect(out.sweep).toEqual([{ key: 'CORI-JP', language: 'ja', swept_at: '2026-10-28T12:00:00.000Z', calls: 2 }])
  })

  it('the Pokémon sweep queue and assignment run on DO SQLite', async () => {
    const out = await inStore('pokemon-sweep', (db) => {
      const card = 2 ** 40 + 1
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at) VALUES (?, 'pkm', 'Blipbug', 'Pokémon', 'pokemon', '', '', '')`
      ).run(card)
      db.prepare(
        `INSERT INTO card_printings (game, card_id, set_name, set_code, set_rarity, language) VALUES ('pkm', ?, 'Set', 'CS3aC 017', 'Normal', 'zh-hans')`
      ).run(card)
      const now = new Date('2026-10-28T12:00:00.000Z')
      const listed = refreshPokemonQueue(db, now)
      const res = assignPokemonSweep(
        db,
        'CS3aC',
        'zh-hans',
        {
          items: [2, 3, 4].map((price, i) => ({ title: 'Chinese Blipbug 017/122 CS3a', price, seller: `s${i}` })),
          calls: 1,
          checkedAt: now.toISOString()
        },
        now
      )
      const prices = db.prepare('SELECT price FROM intl_prices').all()
      return { listed, res, prices }
    })
    expect(out).toEqual({ listed: 1, res: { priced: 1 }, prices: [{ price: 3 }] })
  })
})
