import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateServer } from '../../workers/portal/src/migrate'
import {
  SWEEP_BATCH,
  SWEEP_DAILY_CALLS,
  SWEEP_RESERVE,
  SweepRateLimited,
  ASSIGN_PRINTINGS_SQL,
  assignSweep,
  refreshSweepQueue,
  runSweep,
  sweepClientFor,
  type SetResult,
  type SweepClient
} from '../../workers/portal/src/sweep'
import { sweepKey } from '../../src/shared/prices/sweepKey'
// The Worker keeps its own JS copy of sweepKey; both are pinned on the same cases below.
import { sweepKey as workerSweepKey } from '../../workers/ebay-prices/src/set.js'
import { getMeta } from '../../src/main/db/meta'

const NOW = new Date('2026-10-28T12:00:00.000Z')
const DAY = 24 * 3600 * 1000
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString()

describe('sweepKey', () => {
  it.each([
    ['CORI-JP025', 'CORI-JP'],
    ['LOB-K001', 'LOB-K'],
    ['LOB-001', 'LOB-'],
    ['QCCP-KR100', 'QCCP-KR'],
    ['NODIGITS', 'NODIGITS']
  ])('%s -> %s in both copies', (code, key) => {
    expect(sweepKey(code)).toBe(key)
    expect(workerSweepKey(code)).toBe(key)
  })
})

describe('set sweep', () => {
  let db: Database.Database
  const ids: Record<string, number> = {}

  function printing(tag: string, code: string, rarity: string, lang = 'ja', setName = 'Set'): void {
    const r = db
      .prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (1, ?, ?, ?, ?)`
      )
      .run(setName, code, rarity, lang)
    ids[tag] = Number(r.lastInsertRowid)
  }
  const row = (tag: string): { price: number | null; listing_count: number; checked_at: string; price_seq: number } | undefined =>
    db.prepare('SELECT price, listing_count, checked_at, price_seq FROM intl_prices WHERE printing_id = ?').get(ids[tag]) as never
  const sweepRow = (key: string, lang = 'ja'): Record<string, unknown> =>
    db.prepare('SELECT * FROM price_sweeps WHERE key = ? AND language = ?').get(key, lang) as never

  const entry = (price: number | null, listingCount = 3) => ({ price, listingCount })
  function result(codes: SetResult['codes'], checkedAt = NOW.toISOString(), calls = 2): SetResult {
    return { codes, checkedAt, calls }
  }
  function seedQueue(key: string, extra: { owned?: number; released?: string | null; swept?: string | null } = {}): void {
    db.prepare('INSERT INTO price_sweeps (key, language, owned, released, swept_at) VALUES (?, ?, ?, ?, ?)').run(
      key,
      'ja',
      extra.owned ?? 0,
      extra.released ?? null,
      extra.swept ?? null
    )
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES (1, 'C', 'Monster', 'normal', 'Warrior', '', '')`
    ).run()
    db.prepare(`INSERT INTO card_images (image_id, card_id, sort_order) VALUES (1, 1, 0)`).run()
    printing('ur', 'CORI-JP001', 'Ultra Rare', 'ja', 'Cori')
    printing('se', 'CORI-JP001', 'Secret Rare', 'ja', 'Cori')
    printing('c2', 'CORI-JP002', 'Common', 'ja', 'Cori')
    printing('de', 'CORI-DE001', 'Common', 'de', 'Cori DE')
    printing('lodt', 'LODT-JP005', 'Common', 'ja', 'Lodt')
    db.prepare(`INSERT INTO sets (language, set_name, set_code, tcg_date) VALUES ('ja', 'Cori', 'CORI-JP', '2026-01-01'), ('ja', 'Lodt', 'LODT-JP', '2025-01-01')`).run()
    db.prepare(`INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (1, 'd', 'u', '', '')`).run()
    db.prepare(
      `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at, updated_at) VALUES (1, 'u1', ?, 1, 1, '', '')`
    ).run(ids.lodt)
  })

  describe('refreshSweepQueue', () => {
    it('lists Asian prefixes once a day, owned first', () => {
      expect(refreshSweepQueue(db, NOW)).toBe(2)
      expect(sweepRow('CORI-JP')).toMatchObject({ owned: 0, released: '2026-01-01', swept_at: null })
      expect(sweepRow('LODT-JP')).toMatchObject({ owned: 1, released: '2025-01-01' })
      expect(sweepRow('CORI-DE', 'de')).toBeUndefined()
      expect(refreshSweepQueue(db, new Date(NOW.getTime() + 3600_000))).toBe(0)
      expect(getMeta(db, 'price_sweeps_listed_at')).toBe('2026-10-28')
    })

    it('runs again the next day and keeps swept_at', () => {
      refreshSweepQueue(db, NOW)
      db.prepare(`UPDATE price_sweeps SET swept_at = ? WHERE key = 'CORI-JP'`).run(ago(1))
      expect(refreshSweepQueue(db, new Date(NOW.getTime() + DAY))).toBe(2)
      expect(sweepRow('CORI-JP').swept_at).toBe(ago(1))
    })
    it('upper-cases keys so a lower-case code joins its prefix', () => {
      printing('lc', 'cori-jp003', 'Common', 'ja', 'Cori')
      refreshSweepQueue(db, NOW)
      const keys = (db.prepare(`SELECT key FROM price_sweeps WHERE language = 'ja' ORDER BY key`).all() as { key: string }[]).map((r) => r.key)
      expect(keys).toEqual(['CORI-JP', 'LODT-JP'])
    })
  })

  describe('assignSweep', () => {
    it('prices only the named rarity', () => {
      seedQueue('CORI-JP')
      const out = assignSweep(
        db,
        'CORI-JP',
        'ja',
        result({
          'CORI-JP001': { all: entry(99), byRarity: { 'Ultra Rare': entry(12.5) } },
          'CORI-JP002': { all: entry(1.5), byRarity: {} }
        }),
        NOW
      )
      expect(row('ur')).toMatchObject({ price: 12.5, listing_count: 3 })
      expect(row('se')).toBeUndefined()
      expect(row('c2')).toMatchObject({ price: 1.5 })
      expect(row('de')).toBeUndefined()
      expect(out).toEqual({ priced: 2, skipped: 1 })
      expect(sweepRow('CORI-JP')).toMatchObject({ swept_at: NOW.toISOString(), calls: 2 })
    })

    it('a single-printing code prefers its rarity price over all when it has 2+ listings', () => {
      seedQueue('CORI-JP')
      assignSweep(db, 'CORI-JP', 'ja', result({ 'CORI-JP002': { all: entry(20, 9), byRarity: { Common: entry(10, 2) } } }), NOW)
      expect(row('c2')).toMatchObject({ price: 10, listing_count: 2 })
      assignSweep(
        db,
        'CORI-JP',
        'ja',
        result({ 'CORI-JP002': { all: entry(20, 9), byRarity: { Common: entry(10, 1) } } }, ago(-1)),
        NOW
      )
      expect(row('c2')).toMatchObject({ price: 20, listing_count: 9 })
    })

    it('a multi-printing code with an unknown rarity gets nothing, never all', () => {
      seedQueue('CORI-JP')
      db.prepare(`UPDATE card_printings SET set_rarity = 'Ultra Rare (Alternate art)' WHERE id = ?`).run(ids.se)
      assignSweep(db, 'CORI-JP', 'ja', result({ 'CORI-JP001': { all: entry(99), byRarity: { 'Ultra Rare': entry(12) } } }), NOW)
      expect(row('ur')).toMatchObject({ price: 12 })
      expect(row('se')).toBeUndefined()
    })

    it('skips thin listings (fewer than 2, or no price)', () => {
      seedQueue('CORI-JP')
      assignSweep(
        db,
        'CORI-JP',
        'ja',
        result({
          'CORI-JP001': { all: entry(99), byRarity: { 'Ultra Rare': entry(12, 1), 'Secret Rare': entry(null, 5) } },
          'CORI-JP002': { all: entry(1.5, 1), byRarity: {} }
        }),
        NOW
      )
      expect(row('ur')).toBeUndefined()
      expect(row('se')).toBeUndefined()
      expect(row('c2')).toBeUndefined()
    })

    it('keeps a per-card price newer than the last sweep', () => {
      seedQueue('CORI-JP', { swept: ago(7) })
      db.prepare(`INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 4, 5, ?)`).run(ids.c2, ago(2))
      db.prepare(`INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 4, 5, ?)`).run(ids.ur, ago(9))
      const out = assignSweep(
        db,
        'CORI-JP',
        'ja',
        result({
          'CORI-JP001': { all: entry(99), byRarity: { 'Ultra Rare': entry(12) } },
          'CORI-JP002': { all: entry(1.5), byRarity: {} }
        }),
        NOW
      )
      expect(row('c2')).toMatchObject({ price: 4, checked_at: ago(2) })
      expect(row('ur')).toMatchObject({ price: 12 })
      expect(out).toEqual({ priced: 1, skipped: 2 })
    })

    it('fills a per-card "nothing found" row checked after the last sweep', () => {
      seedQueue('CORI-JP', { swept: ago(7) })
      db.prepare(`INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, NULL, 0, ?)`).run(ids.c2, ago(2))
      const out = assignSweep(db, 'CORI-JP', 'ja', result({ 'CORI-JP002': { all: entry(1.5), byRarity: {} } }), NOW)
      expect(row('c2')).toMatchObject({ price: 1.5, listing_count: 3, checked_at: NOW.toISOString() })
      // Only the CORI-JP001 printings (no result) are skipped.
      expect(out).toEqual({ priced: 1, skipped: 2 })
    })

    it('a never-swept prefix fills a recent per-card "nothing found" row', () => {
      seedQueue('CORI-JP')
      db.prepare(`INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, NULL, 0, ?)`).run(ids.c2, ago(1))
      assignSweep(db, 'CORI-JP', 'ja', result({ 'CORI-JP002': { all: entry(1.5), byRarity: {} } }), NOW)
      expect(row('c2')).toMatchObject({ price: 1.5, checked_at: NOW.toISOString() })
    })

    it('never erases', () => {
      seedQueue('CORI-JP')
      db.prepare(`INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 4, 5, ?)`).run(ids.ur, ago(30))
      assignSweep(db, 'CORI-JP', 'ja', result({}), NOW)
      expect(row('ur')).toMatchObject({ price: 4, checked_at: ago(30) })
      expect(sweepRow('CORI-JP').swept_at).toBe(NOW.toISOString())
    })

    it('an unchanged price does not bump price_seq, a changed one does', () => {
      seedQueue('CORI-JP')
      const codes = (p: number): SetResult['codes'] => ({ 'CORI-JP002': { all: entry(p), byRarity: {} } })
      assignSweep(db, 'CORI-JP', 'ja', result(codes(5), ago(8)), new Date(ago(8)))
      const first = row('c2')!
      expect(first.price_seq).toBeGreaterThan(0)
      assignSweep(db, 'CORI-JP', 'ja', result(codes(5), NOW.toISOString()), NOW)
      expect(row('c2')).toMatchObject({ price_seq: first.price_seq, checked_at: NOW.toISOString() })
      assignSweep(db, 'CORI-JP', 'ja', result(codes(6), new Date(NOW.getTime() + 1000).toISOString()), NOW)
      expect(row('c2')!.price_seq).toBeGreaterThan(first.price_seq)
    })

    it('a listing_count-only change does not bump price_seq', () => {
      db.prepare(`INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 4, 5, ?)`).run(ids.c2, ago(2))
      const seq = row('c2')!.price_seq
      db.prepare('UPDATE intl_prices SET listing_count = 9 WHERE printing_id = ?').run(ids.c2)
      expect(row('c2')).toMatchObject({ listing_count: 9, price_seq: seq })
      db.prepare('UPDATE intl_prices SET price = 5 WHERE printing_id = ?').run(ids.c2)
      expect(row('c2')!.price_seq).toBeGreaterThan(seq)
    })

    it('a sweep never makes its own rows look like fresher per-card prices', () => {
      seedQueue('CORI-JP')
      const later = new Date(NOW.getTime() + 5000).toISOString()
      assignSweep(db, 'CORI-JP', 'ja', result({ 'CORI-JP002': { all: entry(5), byRarity: {} } }, later), NOW)
      expect(sweepRow('CORI-JP').swept_at! >= later).toBe(true)
      const week = new Date(NOW.getTime() + 7 * DAY)
      assignSweep(db, 'CORI-JP', 'ja', result({ 'CORI-JP002': { all: entry(7), byRarity: {} } }, week.toISOString()), week)
      expect(row('c2')).toMatchObject({ price: 7 })
    })
  })

  it('the prefix lookup plans on the set-code index without stats', () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${ASSIGN_PRINTINGS_SQL}`).all('ja', 'CORI-JP%') as { detail: string }[]
    const text = plan.map((r) => r.detail).join('\n')
    expect(text).toContain('idx_printings_set_code')
    expect(text).not.toContain('idx_printings_lang_set')
  })

  it('the daily listing leaves unchanged rows alone', () => {
    refreshSweepQueue(db, NOW)
    const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    refreshSweepQueue(db, new Date(NOW.getTime() + DAY))
    const after = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    // Only the meta day moves.
    expect(after - before).toBe(1)
  })

  describe('Pokémon printings', () => {
    const PKM_CARD = 2 ** 40 + 1
    function pkmPrinting(tag: string, code: string, setName: string): void {
      const r = db
        .prepare(
          `INSERT INTO card_printings (game, card_id, set_name, set_code, set_rarity, language) VALUES ('pkm', ?, ?, ?, 'Normal', 'ja')`
        )
        .run(PKM_CARD, setName, code)
      ids[tag] = Number(r.lastInsertRowid)
    }

    beforeEach(() => {
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at) VALUES (?, 'pkm', 'P', 'Pokémon', 'pokemon', '', '', '')`
      ).run(PKM_CARD)
      db.prepare(`INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'pkm', ?, 0)`).run(PKM_CARD, PKM_CARD)
      db.prepare(`INSERT INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('pkm', 'ja', 'Clay Burst', 'SV2D-JP', '2026-06-01')`).run()
      pkmPrinting('pkmOwn', 'SV2D-JP030', 'Clay Burst')
      // Shares a Yu-Gi-Oh! code: it must neither be priced nor make CORI-JP002 a multi-printing code.
      pkmPrinting('pkmTwin', 'CORI-JP002', 'Clay Burst')
      db.prepare(
        `INSERT INTO collection_entries (user_id, uid, game, printing_id, image_id, quantity, created_at, updated_at, server_seq) VALUES (1, 'u2', 'pkm', ?, ?, 1, '', '', 2)`
      ).run(ids.pkmOwn, PKM_CARD)
    })

    it('are never listed for the sweep', () => {
      expect(refreshSweepQueue(db, NOW)).toBe(2)
      expect(sweepRow('SV2D-JP')).toBeUndefined()
    })

    it('are never priced by a sweep, and leave Yu-Gi-Oh! codes alone', () => {
      seedQueue('CORI-JP')
      assignSweep(db, 'CORI-JP', 'ja', result({ 'CORI-JP002': { all: entry(1.5), byRarity: {} } }), NOW)
      expect(row('c2')).toMatchObject({ price: 1.5 })
      expect(row('pkmTwin')).toBeUndefined()
    })
  })

  describe('runSweep', () => {
    function fakeClient(remaining: number | null = 4000, impl?: (key: string) => Promise<SetResult>) {
      const set = vi.fn(impl ? (k: string) => impl(k) : async () => result({}))
      const quota = vi.fn(async () => ({ remaining }))
      return { client: { set, quota } as unknown as SweepClient, set, quota }
    }

    it('does nothing without a client', async () => {
      refreshSweepQueue(db, NOW)
      expect(await runSweep(db, null, NOW)).toEqual({ swept: 0, calls: 0, more: false })
    })

    it('sweeps due prefixes, owned first, and counts the day', async () => {
      refreshSweepQueue(db, NOW)
      const { client, set } = fakeClient()
      const out = await runSweep(db, client, NOW)
      expect(set.mock.calls.map((c) => c[0])).toEqual(['LODT-JP', 'CORI-JP'])
      expect(out).toEqual({ swept: 2, calls: 4, more: false })
      expect(getMeta(db, 'sweep_calls_day')).toBe('2026-10-28:4')
      // Swept this week: nothing is due.
      expect((await runSweep(db, client, new Date(NOW.getTime() + 1000))).swept).toBe(0)
    })

    it('takes at most SWEEP_BATCH prefixes and reports more', async () => {
      for (let i = 0; i < SWEEP_BATCH + 3; i++) seedQueue(`K${String(i).padStart(2, '0')}-JP`)
      const { client, set } = fakeClient()
      const out = await runSweep(db, client, NOW)
      expect(set).toHaveBeenCalledTimes(SWEEP_BATCH)
      expect(out.more).toBe(true)
    })

    it('stops at the reserve', async () => {
      refreshSweepQueue(db, NOW)
      const { client, set, quota } = fakeClient(1500)
      expect(SWEEP_RESERVE).toBe(2000)
      expect(await runSweep(db, client, NOW)).toMatchObject({ swept: 0, more: false })
      expect(quota).toHaveBeenCalledTimes(1)
      expect(set).not.toHaveBeenCalled()
    })

    it('sweeps on when the quota is unknown', async () => {
      refreshSweepQueue(db, NOW)
      const { client, set } = fakeClient(null)
      await runSweep(db, client, NOW)
      expect(set).toHaveBeenCalled()
    })

    it('stops for the day on 429', async () => {
      refreshSweepQueue(db, NOW)
      const { client, set } = fakeClient(4000, async () => {
        throw new SweepRateLimited()
      })
      expect(await runSweep(db, client, NOW)).toMatchObject({ swept: 0, more: false })
      expect(set).toHaveBeenCalledTimes(1)
      expect(getMeta(db, 'sweep_calls_day')).toBe(`2026-10-28:${SWEEP_DAILY_CALLS}`)
      const next = fakeClient()
      expect((await runSweep(db, next.client, new Date(NOW.getTime() + 60_000))).swept).toBe(0)
      expect(next.set).not.toHaveBeenCalled()
      // A new UTC day starts fresh.
      expect((await runSweep(db, next.client, new Date(NOW.getTime() + DAY))).swept).toBe(2)
    })

    it('respects the daily cap', async () => {
      refreshSweepQueue(db, NOW)
      db.prepare(`INSERT INTO meta (key, value) VALUES ('sweep_calls_day', ?)`).run(`2026-10-28:${SWEEP_DAILY_CALLS - 3}`)
      const { client, set } = fakeClient(4000, async () => result({}, NOW.toISOString(), 2))
      const out = await runSweep(db, client, NOW)
      // 3 calls left: the first prefix (2 calls) runs, the second still starts (1 left), then the cap is spent.
      expect(set).toHaveBeenCalledTimes(2)
      expect(out.more).toBe(false)
      expect(Number(getMeta(db, 'sweep_calls_day')!.split(':')[1])).toBe(SWEEP_DAILY_CALLS + 1)
    })

    it('a failed set search still counts one call against the day', async () => {
      refreshSweepQueue(db, NOW)
      const { client } = fakeClient(4000, async (k) => {
        if (k === 'LODT-JP') throw new Error('400')
        return result({}, NOW.toISOString(), 2)
      })
      await runSweep(db, client, NOW)
      expect(getMeta(db, 'sweep_calls_day')).toBe('2026-10-28:3')
    })

    it('a failing prefix backs off and does not block the next one on the following run', async () => {
      refreshSweepQueue(db, NOW)
      // LODT-JP (owned) sorts first and always fails.
      const { client, set } = fakeClient(4000, async (k) => {
        if (k === 'LODT-JP') throw new Error('400')
        return result({})
      })
      await runSweep(db, client, NOW)
      expect(sweepRow('LODT-JP').swept_at).toBe(ago(6))
      expect(sweepRow('CORI-JP').swept_at).not.toBeNull()
      set.mockClear()
      // Nothing due the next hour; a day later the failed prefix is retried.
      await runSweep(db, client, new Date(NOW.getTime() + 3600_000))
      expect(set).not.toHaveBeenCalled()
      await runSweep(db, client, new Date(NOW.getTime() + 2 * DAY))
      expect(set.mock.calls.map((c) => c[0])).toEqual(['LODT-JP'])
    })

    it('counts calls spent even when writing the result throws', async () => {
      refreshSweepQueue(db, NOW)
      db.exec('DROP TABLE intl_prices')
      const { client } = fakeClient(4000, async () =>
        result({ 'CORI-JP002': { all: entry(5), byRarity: {} } }, NOW.toISOString(), 3)
      )
      const out = await runSweep(db, client, NOW)
      expect(out.swept).toBe(0)
      expect(getMeta(db, 'sweep_calls_day')).toBe('2026-10-28:6')
    })

    it('an error from one prefix does not lose the others already swept', async () => {
      refreshSweepQueue(db, NOW)
      const { client } = fakeClient(4000, async (k) => {
        if (k === 'CORI-JP') throw new Error('boom')
        return result({})
      })
      const out = await runSweep(db, client, NOW)
      expect(out.swept).toBe(1)
      expect(sweepRow('LODT-JP').swept_at).not.toBeNull()
      expect(sweepRow('CORI-JP').swept_at).toBe(ago(6))
    })
  })

  describe('sweepClientFor', () => {
    it('is null without a URL, and speaks to the binding with the client header', async () => {
      expect(sweepClientFor({ PRICE_WORKER_URL: '' })).toBeNull()
      const calls: { url: string; headers: unknown }[] = []
      const binding = {
        fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
          calls.push({ url: String(url), headers: init?.headers })
          const u = String(url)
          if (u.includes('/v1/quota')) return Response.json({ remaining: 3000, resetAt: 'x' })
          if (u.includes('KEY429')) return new Response('{}', { status: 429 })
          return Response.json({ codes: {}, calls: 1, checkedAt: 'now' })
        }
      }
      const c = sweepClientFor({ PRICE_WORKER_URL: 'https://p.test/', PRICES: binding })!
      expect(await c.quota()).toEqual({ remaining: 3000 })
      expect((await c.set('CORI-JP', 'ja')).codes).toEqual({})
      expect(calls[1].url).toBe('https://p.test/v1/set?key=CORI-JP&lang=ja')
      expect(calls[1].headers).toEqual({ 'X-Client': 'duel-binder' })
      await expect(c.set('KEY429', 'ja')).rejects.toBeInstanceOf(SweepRateLimited)
    })
  })
})
