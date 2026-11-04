import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateServer } from '../../workers/portal/src/migrate'
import {
  ONEPIECE_PRINTINGS_SQL,
  ONEPIECE_SET_CALLS,
  ONEPIECE_SWEEP_BATCH,
  assignOnePieceSweep,
  listingKind,
  onePieceDailyCalls,
  onePieceSetPrices,
  opPrefixOf,
  parseOnePieceListing,
  printingKind,
  refreshOnePieceQueue,
  runOnePieceSweep,
  type OpSetPrinting
} from '../../workers/portal/src/onePieceSweep'
import { refreshPokemonQueue, runPokemonSweep } from '../../workers/portal/src/pokemonSweep'
import {
  SWEEP_DAILY_CALLS,
  SWEEP_RESERVE,
  SweepRateLimited,
  runSweep,
  sweepClientFor,
  type PokemonListing,
  type PokemonListings,
  type SweepClient
} from '../../workers/portal/src/sweep'
import { runPriceAlarm } from '../../workers/portal/src/prices'
import { getMeta, setMeta } from '../../src/main/db/meta'
import { onePieceCardId } from '../../src/shared/games'

const NOW = new Date('2026-11-04T12:00:00.000Z')
const DAY = 24 * 3600 * 1000
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString()

describe('the setting', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['0', 0],
    ['off', 0],
    ['2.5', 0],
    ['60', 60],
    ['5000', 200]
  ])('%s -> %s', (raw, calls) => expect(onePieceDailyCalls(raw)).toBe(calls))
})

describe('number prefixes', () => {
  it('sweeps booster, deck, extra and premium prefixes, not promos', () => {
    expect(opPrefixOf('OP17-005')).toBe('OP17')
    expect(opPrefixOf('EB04-061')).toBe('EB04')
    expect(opPrefixOf('ST01-012')).toBe('ST01')
    expect(opPrefixOf('PRB02-001')).toBe('PRB02')
    expect(opPrefixOf('P-084')).toBeNull()
    expect(opPrefixOf('DON!!')).toBeNull()
  })
})

describe('the version a title names', () => {
  it.each([
    ['ONE PIECE Trafalgar Law OP10-119 SEC Manga Alt Art Comic Parallel Royal Blood JP', 'manga'],
    ['One Piece Nefeltari Vivi SR-SPC EB03-024 One Piece Heroines edition Japanese NM', 'sp'],
    ['Uta OP05-119 SP Parallel Japanese', 'sp'],
    ['Shanks OP01-120 TR Treasure Rare Japanese', 'tr'],
    ['Kaido OP06-062 Super Parallel Japanese', 'super'],
    ['Luffy OP09-119 SEC Wanted Poster Japanese', 'wanted'],
    ['Charlotte Katakuri OP03-099 Alternate Art Japanese NM', 'parallel'],
    ['Zoro OP01-025 SR Parallel Japanese', 'parallel'],
    ['Zoro OP01-025 SR AA Japanese', 'parallel'],
    ['Vinsmoke Reiju SR OP12-063 Legacy of the Master One Piece Japanese', 'base'],
    ['Luffy OP05-119 SP TR Japanese', null]
  ])('%s -> %s', (title, kind) => expect(listingKind(title)).toBe(kind))

  it('reads a printing label', () => {
    expect(printingKind('SR')).toBe('base')
    expect(printingKind('L')).toBe('base')
    expect(printingKind('SP')).toBe('sp')
    expect(printingKind('SP (2)')).toBe('sp')
    expect(printingKind('TR')).toBe('tr')
    expect(printingKind('SR (Parallel)')).toBe('parallel')
    expect(printingKind('SR (Parallel 2)')).toBe('parallel')
    expect(printingKind('SR (Alternate Art)')).toBe('parallel')
    expect(printingKind('SEC (Manga)')).toBe('manga')
    expect(printingKind('SR (Super Alternate Art)')).toBe('super')
    expect(printingKind('SEC (Wanted Poster)')).toBe('wanted')
    expect(printingKind('C (Reprint)')).toBeNull()
    expect(printingKind('P (フラッグシップバトル2024 1月優勝記念品)')).toBeNull()
  })
})

describe('parseOnePieceListing', () => {
  it('takes one raw Japanese single of the swept prefix', () => {
    expect(parseOnePieceListing('Vinsmoke Reiju SR OP12-063 Legacy of the Master One Piece Japanese', 'OP12')).toEqual({
      number: 'OP12-063', kind: 'base'
    })
    expect(parseOnePieceListing('ONE PIECE Trafalgar Law OP10-119 SEC Manga Alt Art Comic Parallel Royal Blood JP', 'OP10'))
      .toEqual({ number: 'OP10-119', kind: 'manga' })
  })

  it.each([
    ['English', 'Charlotte Katakuri (067) OP11-067 A Fist of Divine Speed Foil English', 'OP11'],
    ['no language', 'Charlotte Katakuri (067) OP11-067 A Fist of Divine Speed Foil', 'OP11'],
    ['Chinese too', 'Uta EB03-003 SP SR Parallel ONE PIECE Chinese Card Heroines Edition 2025 NM Japanese', 'EB03'],
    ['graded', 'PSA 10 Shanks OP01-120 SEC Japanese', 'OP01'],
    ['several cards', 'Otama OP01-006 3 Card Set (UnCommon) PRB-01 ONE PIECE Card THE Best Japanese', 'OP01'],
    ['an event card', 'ONE PIECE TCG KID & KILLER EB01-003 Offline Regional FINALIST CARD Japanese', 'EB01'],
    ['an anniversary card', 'Buggy ONE PIECE Card OP09-051 3rd Anniversary Silver Parallel SP Japanese NM', 'OP09'],
    ['a promo', 'Luffy OP11-001 Promo Japanese', 'OP11'],
    ['sealed', 'ONE PIECE Card Game Extra Booster Box EB-03 Heroines Japanese', 'EB03'],
    ['two numbers', 'Zoro OP01-025 Luffy OP01-024 Japanese', 'OP01'],
    ['another prefix', 'Zoro OP01-025 SR Japanese', 'OP12']
  ])('drops %s', (_, title, prefix) => {
    expect(parseOnePieceListing(title, prefix)).toBeNull()
  })

  it('a DON!! card is not a card of the set', () => {
    expect(parseOnePieceListing('DON!! Card OP12 Gold Japanese', 'OP12')).toBeNull()
  })
})

describe('onePieceSetPrices', () => {
  const P = (id: number, code: string, version: string): OpSetPrinting => ({ id, code, version })
  const items = (title: string, prices: number[]): PokemonListing[] =>
    prices.map((price, i) => ({ title, price, seller: `s${title.length}-${i}` }))
  const printings = [
    P(1, 'OP05-119', 'SEC'),
    P(2, 'OP05-119', 'SEC (Manga)'),
    P(3, 'OP05-119', 'SEC (Alternate Art)'),
    P(4, 'OP05-001', 'L'),
    P(5, 'OP05-001', 'L (Parallel)'),
    P(6, 'OP05-001', 'L (Parallel 2)'),
    P(7, 'OP05-119', 'SP')
  ]

  it('prices each version from its own titles', () => {
    const out = onePieceSetPrices([
      ...items('Luffy OP05-119 SEC Japanese', [10, 11, 12]),
      ...items('Luffy OP05-119 SEC Manga Japanese', [900, 1000, 1100]),
      ...items('Luffy OP05-119 SEC Alt Art Japanese', [50, 55, 60]),
      ...items('Luffy OP05-119 SP Japanese', [200, 210, 220])
    ], printings, 'OP05')
    expect(Object.fromEntries([...out].map(([id, p]) => [id, p.price]))).toEqual({ 1: 11, 2: 1000, 3: 55, 7: 210 })
  })

  it('needs three sellers', () => {
    expect(onePieceSetPrices(items('Luffy OP05-119 SEC Japanese', [10, 11]), printings, 'OP05').size).toBe(0)
  })

  it('counts a seller once, at their cheapest', () => {
    const three = items('Luffy OP05-119 SEC Japanese', [10, 11, 12])
    const alone = onePieceSetPrices(three, printings, 'OP05').get(1)
    // The first seller again, dearer: still one seller, at 10.
    const out = onePieceSetPrices([...three, { ...three[0], title: 'Luffy OP05-119 SEC Japanese NM', price: 10.5 }], printings, 'OP05')
    expect(out.get(1)).toEqual(alone)
    expect(alone?.listingCount).toBe(3)
  })

  it('two parallels that cannot be told apart get no price; the base still does', () => {
    const out = onePieceSetPrices([
      ...items('Luffy OP05-001 L Parallel Japanese', [30, 31, 32]),
      ...items('Luffy OP05-001 L Japanese', [2, 2, 2])
    ], printings, 'OP05')
    expect(out.has(5)).toBe(false)
    expect(out.has(6)).toBe(false)
    expect(out.get(4)?.price).toBe(2)
  })

  it('a kind the number lacks prices nothing, and never another version', () => {
    const out = onePieceSetPrices(items('Luffy OP05-119 TR Japanese', [500, 510, 520]), printings, 'OP05')
    expect(out.size).toBe(0)
  })

  it('thin listings whose sellers disagree are dropped', () => {
    expect(onePieceSetPrices(items('Luffy OP05-119 SEC Japanese', [5, 6, 40]), printings, 'OP05').size).toBe(0)
  })
})

describe('the One Piece sweep', () => {
  let db: Database.Database
  const ids: Record<string, number> = {}
  const CARD = onePieceCardId('ja', 'OP05-119')

  function printing(tag: string, code: string, version: string, o: { lang?: string; set?: string; setCode?: string; game?: string } = {}): void {
    const set = o.set ?? 'AWAKENING OF THE NEW ERA [OP-05]'
    db.prepare(`INSERT OR IGNORE INTO sets (game, language, set_name, set_code) VALUES (?, ?, ?, ?)`).run(
      o.game ?? 'op', o.lang ?? 'ja', set, o.setCode ?? 'OP05'
    )
    const r = db
      .prepare(`INSERT INTO card_printings (game, card_id, set_name, set_code, set_rarity, set_rarity_code, language) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(o.game ?? 'op', CARD, set, code, version, code, o.lang ?? 'ja')
    ids[tag] = Number(r.lastInsertRowid)
  }
  const row = (tag: string): { price: number; listing_count: number } | undefined =>
    db.prepare('SELECT price, listing_count FROM intl_prices WHERE printing_id = ?').get(ids[tag]) as never
  const opKeys = (): unknown => db.prepare(`SELECT key, language FROM price_sweeps WHERE key LIKE 'op:%' ORDER BY key`).all()
  function ygoPrefix(key: string, swept: string | null): void {
    db.prepare('INSERT INTO price_sweeps (key, language, swept_at) VALUES (?, ?, ?)').run(key, 'ja', swept)
  }
  function opPrefix(prefix: string, swept: string | null = null): void {
    db.prepare('INSERT INTO price_sweeps (key, language, swept_at) VALUES (?, ?, ?)').run(`op:${prefix}`, 'ja', swept)
  }
  /** Prefixes swept yesterday: the queue is spread over days, and these let two run in a day. */
  function padQueue(): void {
    for (let i = 0; i < 10; i++) opPrefix(`ZZ${String(i).padStart(2, '0')}`, ago(1))
  }
  function fakeClient(remaining: number | null = 4000, impl?: (code: string, lang: string) => Promise<PokemonListings>) {
    const onePieceListings = vi.fn(impl ?? (async () => ({ items: [], calls: 2, checkedAt: NOW.toISOString() })))
    const pokemonListings = vi.fn(async () => ({ items: [], calls: 1, checkedAt: NOW.toISOString() }))
    const set = vi.fn(async () => ({ codes: {}, calls: 1, checkedAt: NOW.toISOString() }))
    const quota = vi.fn(async () => ({ remaining }))
    return {
      client: { set, quota, pokemonListings, onePieceListings } as unknown as SweepClient,
      onePieceListings, pokemonListings, set, quota
    }
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    db.prepare(`INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at) VALUES (?, 'op', 'Luffy', 'Character', 'op', '', '', '')`).run(CARD)
    printing('base', 'OP05-119', 'SEC')
    printing('manga', 'OP05-119', 'SEC (Manga)')
    printing('st', 'ST01-012', 'SR', { set: 'Straw Hat Crew [ST-01]', setCode: 'ST01' })
    printing('promo', 'P-001', 'P', { set: 'Promotion Cards', setCode: 'P' })
    printing('en', 'OP06-001', 'L', { lang: 'en', set: 'WINGS', setCode: 'OP06' })
  })

  describe('refreshOnePieceQueue', () => {
    it('lists Japanese prefixes once a day under op: keys, not English or promo ones', () => {
      expect(refreshOnePieceQueue(db, NOW)).toBe(2)
      expect(refreshOnePieceQueue(db, new Date(NOW.getTime() + 1000))).toBe(0)
      expect(opKeys()).toEqual([
        { key: 'op:OP05', language: 'ja' },
        { key: 'op:ST01', language: 'ja' }
      ])
    })

    it('an SP of an older number in a newer set is swept with its number', () => {
      printing('sp', 'OP05-119', 'SP', { set: 'THE WORLD’S STRONGEST WARRIORS [OP-17]', setCode: 'OP17' })
      refreshOnePieceQueue(db, NOW)
      expect(opKeys()).toEqual([
        { key: 'op:OP05', language: 'ja' },
        { key: 'op:ST01', language: 'ja' }
      ])
    })
  })

  describe('assignOnePieceSweep', () => {
    const listings = (title: string, prices: number[]): PokemonListings => ({
      items: prices.map((price, i) => ({ title, price, seller: `s${i}` })),
      calls: 2,
      checkedAt: NOW.toISOString()
    })

    it('writes the price and stamps the prefix; never erases', () => {
      opPrefix('OP05')
      expect(assignOnePieceSweep(db, 'OP05', 'ja', listings('Luffy OP05-119 SEC Manga Japanese', [900, 1000, 1100]), NOW)).toEqual({ priced: 1 })
      expect(row('manga')).toEqual({ price: 1000, listing_count: 3 })
      expect(row('base')).toBeUndefined()
      expect(db.prepare(`SELECT swept_at, calls FROM price_sweeps WHERE key = 'op:OP05'`).get()).toEqual({ swept_at: NOW.toISOString(), calls: 2 })
      assignOnePieceSweep(db, 'OP05', 'ja', { items: [], calls: 1 }, NOW)
      expect(row('manga')).toEqual({ price: 1000, listing_count: 3 })
    })

    it('never prices an English, promo, other-game or market-priced printing', () => {
      printing('enTwin', 'OP05-119', 'SEC (Manga)', { lang: 'en', set: 'AWAKENING EN', setCode: 'OP05' })
      printing('pr', 'OP05-119', 'SEC (Manga)', { set: 'Promotion Cards', setCode: 'P' })
      db.prepare(`INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES (7, 'Y', 'Monster', 'normal', 'W', '', '')`).run()
      const y = db.prepare(`INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (7, 'Y', 'OP05-119', 'SEC (Manga)', 'ja')`).run()
      ids.ygo = Number(y.lastInsertRowid)
      opPrefix('OP05')
      assignOnePieceSweep(db, 'OP05', 'ja', listings('Luffy OP05-119 SEC Japanese', [10, 11, 12]), NOW)
      expect(row('base')).toEqual({ price: 11, listing_count: 3 })
      for (const t of ['enTwin', 'pr', 'ygo']) expect(row(t)).toBeUndefined()
      db.prepare('UPDATE card_printings SET market_price = 5 WHERE id = ?').run(ids.manga)
      db.prepare('DELETE FROM intl_prices').run()
      assignOnePieceSweep(db, 'OP05', 'ja', listings('Luffy OP05-119 SEC Manga Japanese', [900, 1000, 1100]), NOW)
      expect(row('manga')).toBeUndefined()
    })

    it('plans on the set-code index without stats', () => {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${ONEPIECE_PRINTINGS_SQL}`).all('OP05-%') as { detail: string }[]
      expect(plan.map((r) => r.detail).join('\n')).toContain('idx_printings_set_code')
    })
  })

  describe('runOnePieceSweep', () => {
    beforeEach(padQueue)

    it('is off by default', async () => {
      const { client, quota, onePieceListings } = fakeClient()
      expect(await runOnePieceSweep(db, client, NOW, 0, 0)).toEqual({ swept: 0, calls: 0 })
      expect(quota).not.toHaveBeenCalled()
      expect(onePieceListings).not.toHaveBeenCalled()
    })

    it('sweeps prefixes and counts on the shared day', async () => {
      const { client, onePieceListings } = fakeClient()
      setMeta(db, 'sweep_calls_day', '2026-11-04:7')
      expect(await runOnePieceSweep(db, client, NOW, 60, 0)).toEqual({ swept: 2, calls: 4 })
      expect(onePieceListings.mock.calls.sort()).toEqual([['OP05', 'ja'], ['ST01', 'ja']])
      expect(getMeta(db, 'sweep_calls_day')).toBe('2026-11-04:11')
      expect(getMeta(db, 'sweep_onepiece_day')).toBe('2026-11-04:4:2')
    })

    it('waits while any Yu-Gi-Oh! prefix is due', async () => {
      ygoPrefix('CORI-JP', null)
      const { client, onePieceListings, quota } = fakeClient()
      expect(await runOnePieceSweep(db, client, NOW, 60, 0)).toEqual({ swept: 0, calls: 0 })
      expect(onePieceListings).not.toHaveBeenCalled()
      expect(quota).not.toHaveBeenCalled()
    })

    it("leaves what Pokémon may still spend today, as well as Yu-Gi-Oh!'s reserve", async () => {
      const { client, onePieceListings } = fakeClient(100_000)
      // Pokémon has 100 a day and spent 10: 90 are its. 2000 - 1904 - 90 = 6, two prefixes' worth.
      setMeta(db, 'sweep_pokemon_day', '2026-11-04:10:2')
      setMeta(db, 'sweep_calls_day', '2026-11-04:1904')
      expect((await runOnePieceSweep(db, client, NOW, 60, 100)).swept).toBe(2)
      onePieceListings.mockClear()
      setMeta(db, 'sweep_calls_day', '2026-11-04:1906')
      setMeta(db, 'sweep_onepiece_day', '2026-11-04:0:0')
      db.prepare(`UPDATE price_sweeps SET swept_at = NULL WHERE key IN ('op:OP05', 'op:ST01')`).run()
      // 4 left: one prefix.
      expect((await runOnePieceSweep(db, client, NOW, 60, 100)).swept).toBe(1)
    })

    it('respects its own daily calls and the shared cap', async () => {
      const { client, onePieceListings } = fakeClient(4000, async () => ({ items: [], calls: 3 }))
      expect((await runOnePieceSweep(db, client, NOW, ONEPIECE_SET_CALLS, 0)).swept).toBe(1)
      onePieceListings.mockClear()
      await runOnePieceSweep(db, client, NOW, ONEPIECE_SET_CALLS, 0)
      expect(onePieceListings).not.toHaveBeenCalled()
      setMeta(db, 'sweep_onepiece_day', '2026-11-04:0:0')
      setMeta(db, 'sweep_calls_day', `2026-11-04:${SWEEP_DAILY_CALLS - ONEPIECE_SET_CALLS + 1}`)
      await runOnePieceSweep(db, client, NOW, 60, 0)
      expect(onePieceListings).not.toHaveBeenCalled()
    })

    it('a batch an alarm', async () => {
      for (let i = 10; i < 30; i++) printing(`x${i}`, `OP${i}-001`, 'C', { set: `S${i}`, setCode: `OP${i}` })
      const { client, onePieceListings } = fakeClient(4000, async () => ({ items: [], calls: 1 }))
      await runOnePieceSweep(db, client, NOW, 200, 0)
      expect(onePieceListings).toHaveBeenCalledTimes(ONEPIECE_SWEEP_BATCH)
    })

    it('stands down at the reserve, or when the quota is unknown', async () => {
      const low = fakeClient(SWEEP_RESERVE + 2 * ONEPIECE_SET_CALLS)
      expect((await runOnePieceSweep(db, low.client, NOW, 60, 0)).swept).toBe(0)
      const unknown = fakeClient(null)
      expect((await runOnePieceSweep(db, unknown.client, NOW, 60, 0)).swept).toBe(0)
      expect(low.onePieceListings).not.toHaveBeenCalled()
      expect(unknown.onePieceListings).not.toHaveBeenCalled()
    })

    it('a rate limit stops it for the day; a failing prefix backs off and the next still runs', async () => {
      const limited = fakeClient(4000, async () => {
        throw new SweepRateLimited()
      })
      await runOnePieceSweep(db, limited.client, NOW, 60, 0)
      expect(limited.onePieceListings).toHaveBeenCalledTimes(1)
      await runOnePieceSweep(db, limited.client, new Date(NOW.getTime() + 1000), 60, 0)
      expect(limited.onePieceListings).toHaveBeenCalledTimes(1)
      setMeta(db, 'sweep_onepiece_day', '')
      const failing = fakeClient(4000, async (code) => {
        if (code === 'OP05') throw new Error('502')
        return { items: [], calls: 1 }
      })
      expect(await runOnePieceSweep(db, failing.client, NOW, 60, 0)).toEqual({ swept: 1, calls: 2 })
      const sweptAt = (k: string): unknown => (db.prepare('SELECT swept_at AS s FROM price_sweeps WHERE key = ?').get(k) as { s: string }).s
      expect(sweptAt('op:OP05')).toBe(ago(6))
      expect(sweptAt('op:ST01')).toBe(NOW.toISOString())
    })
  })

  describe('leaves Yu-Gi-Oh! and Pokémon alone', () => {
    it("Yu-Gi-Oh!'s sweep neither sees nor is held up by op rows", async () => {
      opPrefix('OP05')
      ygoPrefix('CORI-JP', null)
      const { client, set, onePieceListings } = fakeClient()
      expect(await runSweep(db, client, NOW)).toEqual({ swept: 1, calls: 1, more: false })
      expect(set.mock.calls).toEqual([['CORI-JP', 'ja']])
      expect(onePieceListings).not.toHaveBeenCalled()
    })

    it("Pokémon's sweep is not held up by op rows due, nor reserves for them", async () => {
      // A Chinese Pokémon set, and op rows due that Pokémon must not read as Yu-Gi-Oh! work.
      db.prepare(`INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at) VALUES (?, 'pkm', 'Mew', 'Pokémon', 'pokemon', '', '', '')`).run(2 ** 40 + 5)
      db.prepare(`INSERT INTO card_printings (game, card_id, set_name, set_code, set_rarity, language) VALUES ('pkm', ?, 'S', 'CS3aC 017', 'Normal', 'zh-hans')`).run(2 ** 40 + 5)
      for (let i = 0; i < 10; i++) db.prepare('INSERT INTO price_sweeps (key, language, swept_at) VALUES (?, ?, ?)').run(`pkm:DONE${i}C`, 'zh-hans', ago(1))
      for (let i = 0; i < 400; i++) opPrefix(`Q${i}`, ago(6.6))
      refreshPokemonQueue(db, NOW)
      const { client, pokemonListings } = fakeClient(100_000)
      expect((await runPokemonSweep(db, client, NOW, 100)).swept).toBe(1)
      expect(pokemonListings).toHaveBeenCalledTimes(1)
    })

    const storage = () => {
      let alarm: number | null = null
      return { getAlarm: async () => alarm, setAlarm: async (t: number) => void (alarm = t), at: () => alarm }
    }

    it('the alarm sweeps One Piece only with its setting, after Pokémon, at its idle pace', async () => {
      padQueue()
      const off = fakeClient()
      await runPriceAlarm(db, null, storage(), () => NOW, off.client, { pokemonDailyCalls: 100 })
      expect(off.onePieceListings).not.toHaveBeenCalled()
      const on = fakeClient()
      const s = storage()
      await runPriceAlarm(db, null, s, () => NOW, on.client, { pokemonDailyCalls: 100, onePieceDailyCalls: 60 })
      expect(on.onePieceListings).toHaveBeenCalledTimes(2)
      expect(s.at()).toBe(NOW.getTime() + 21_600_000)
    })
  })

  describe('sweepClientFor', () => {
    it('asks the Worker by prefix and language, and reads a 429', async () => {
      const urls: string[] = []
      const binding = {
        fetch: async (url: RequestInfo | URL) => {
          urls.push(String(url))
          if (String(url).includes('RATE')) return new Response('{}', { status: 429 })
          if (String(url).includes('BAD')) return Response.json({ nope: 1 })
          return Response.json({ items: [{ title: 't', price: 1, seller: 's' }], calls: 1 })
        }
      }
      const c = sweepClientFor({ PRICE_WORKER_URL: 'https://p.test/', PRICES: binding })!
      expect((await c.onePieceListings('OP05', 'ja')).items).toHaveLength(1)
      expect(urls[0]).toBe('https://p.test/v1/onepiece-listings?code=OP05&lang=ja')
      await expect(c.onePieceListings('RATE', 'ja')).rejects.toBeInstanceOf(SweepRateLimited)
      await expect(c.onePieceListings('BAD', 'ja')).rejects.toThrow('unexpected')
    })
  })
})
