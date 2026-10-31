import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateServer } from '../../workers/portal/src/migrate'
import {
  MIN_SELLERS,
  POKEMON_PRINTINGS_SQL,
  POKEMON_SET_CALLS,
  POKEMON_SWEEP_BATCH,
  assignPokemonSweep,
  languageOk,
  listingFinish,
  nameOk,
  parseListing,
  pokemonCodes,
  pokemonDailyCalls,
  pokemonNumberOf,
  pokemonSetOf,
  pokemonSetPrices,
  refreshPokemonQueue,
  runPokemonSweep,
  type SetPrinting
} from '../../workers/portal/src/pokemonSweep'
import {
  SWEEP_DAILY_CALLS,
  SWEEP_RESERVE,
  SweepRateLimited,
  refreshSweepQueue,
  runSweep,
  sweepClientFor,
  type PokemonListing,
  type PokemonListings,
  type SweepClient
} from '../../workers/portal/src/sweep'
import { runPriceAlarm } from '../../workers/portal/src/prices'
import { getMeta, setMeta } from '../../src/main/db/meta'

const NOW = new Date('2026-10-28T12:00:00.000Z')
const DAY = 24 * 3600 * 1000
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString()

const CS4B = ['CS4bC', 'CS4b']
const CS3A = ['CS3aC', 'CS3a']

describe('the setting', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['0', 0],
    ['off', 0],
    ['-5', 0],
    ['1.5', 0],
    ['100', 100],
    ['99999', 200]
  ])('%s -> %s', (raw, calls) => expect(pokemonDailyCalls(raw)).toBe(calls))
})

describe('set codes', () => {
  it('reads the catalog forms', () => {
    expect(pokemonSetOf('30thC 114/103')).toBe('30thC')
    expect(pokemonSetOf('CSV9.5C 012')).toBe('CSV9.5C')
    expect(pokemonNumberOf('30thC 014/103')).toBe('14')
    expect(pokemonNumberOf('CSV9.5C 012')).toBe('12')
    expect(pokemonNumberOf('CBB4C 0103')).toBe('103')
    expect(pokemonNumberOf('CBB6C 1001')).toBe('1001')
    expect(pokemonNumberOf('CSV5C GRA')).toBeNull()
  })

  it('drops the trailing C only where what is left is still a code', () => {
    expect(pokemonCodes('CS3aC', 'zh-hans')).toEqual(['CS3aC', 'CS3a'])
    expect(pokemonCodes('CSV9.5C', 'zh-hans')).toEqual(['CSV9.5C', 'CSV9.5'])
    expect(pokemonCodes('30thC', 'zh-hans')).toEqual(['30thC'])
    expect(pokemonCodes('151C', 'zh-hans')).toEqual(['151C'])
    expect(pokemonCodes('CSIC', 'zh-hans')).toEqual(['CSIC'])
    expect(pokemonCodes('SV8aC', 'zh-hant')).toEqual(['SV8aC'])
  })
})

describe('language', () => {
  it.each([
    ['Chinese Boltund V 044/132 cs4b Sword & Shield Double Rare Holo Pokémon 2024 NM'],
    ['Entei 018/125 Holo (CS3aC) S-Chinese'],
    ['2023 POKEMON S.CHINESE CS3a ARTS 135'],
    ['POKEMON SCHINESE CS4b 165'],
    ['010/115 - Galarian Darmanitan V cs2b Simplified Chinese Pokémon Individual Card']
  ])('Simplified takes %s', (title) => expect(languageOk(title, 'zh-hans')).toBe(true))

  it.each([
    ['Eevee C 050/064 SV6a Night Wanderer Pokemon Card Japanese'],
    ['PSA10 Pokemon Card 30th Anniversary Chinese Starter Set 9pcs Japanese'],
    ['2006 EX TRAINER KIT 2 Plusle & Minun Traditional Chinese Pokemon Card'],
    ['Mew 044/132 T-Chinese Pokemon'],
    ['Mew 044/132 Chinese Taiwan'],
    ['Mew 044/132 cs4b Pokemon']
  ])('Simplified refuses %s', (title) => expect(languageOk(title, 'zh-hans')).toBe(false))

  it('Traditional must say so', () => {
    expect(languageOk('Mew 044/132 Traditional Chinese', 'zh-hant')).toBe(true)
    expect(languageOk('Mew 044/132 T-Chinese', 'zh-hant')).toBe(true)
    expect(languageOk('Mew 044/132 Chinese', 'zh-hant')).toBe(false)
    expect(languageOk('Mew 044/132 S-Chinese', 'zh-hant')).toBe(false)
  })
})

describe('parseListing, on real eBay titles', () => {
  it.each([
    ['Chinese Boltund V 044/132 cs4b Sword & Shield Double Rare Holo Pokémon 2024 NM', CS4B, '44', 'holo'],
    ['HOOPA V #079/132 cs4b S-CHINESE POKEMON SWORD & SHIELD DOUBLE RARE HOLO NM', CS4B, '79', 'holo'],
    ['Lycanroc V 067/132 cs4b Sword & Shield Chinese Pokémon TCG Collectible Card', CS4B, '67', 'plain'],
    ['Chinese CS3A  #017/122 Blipbug', CS3A, '17', 'plain'],
    ['Entei 018/125 Holo (CS3aC) S-Chinese', CS3A, '18', 'holo'],
    ['Pokemon Crobat Vmax #075/115 CS2BC Chinese Vivid Portrayals Triple Rare', ['CS2bC', 'CS2b'], '75', 'plain'],
    ['Pokemon Barraskewda #023/115 Chinese CS2b Vivid Portrayals Reverse Holo', ['CS2bC', 'CS2b'], '23', 'reverse'],
    ['Genesect EX 30thC-155/103 Pokémon TCG Chinese 30th Celebration', ['30thC'], '155', 'plain'],
    ['2026 Pokémon Chinese 30th Anniversary Celebration Mewtwo Ex 30thC-134/103 FUR NM', ['30thC'], '134', 'plain']
  ])('takes %s', (title, codes, number, finish) => {
    expect(parseListing(title, codes, 'zh-hans')).toEqual({ number, finish })
  })

  it.each([
    // Slabs.
    ['2023 POKEMON S.CHINESE CS3a ARTS: OVERGROW 165 SR CALYREX VMAX HR PSA 10', CS3A],
    ['2024 POKEMON CS4B CHINESE MEW VMAX #162/132 HR wcg 10 ≈ psa', CS4B],
    ['2023 Pokemon STOUTLAND CSM2cC 152/150 CHR 2023 CHINESE PCG 9 MT 11019542', ['CSM2cC', 'CSM2c']],
    ['PCG10+ Pristine Pokémon 30th Anniversary Celebration Lugia 30thC-142/103 Chinese', ['30thC']],
    ['Gengar Vmax Simplified Chinese CS4B #073 73/132 2024 PSA10', CS4B],
    ['CCIC BLUE 1O RAYQUAZA V CS4B SUPER RARE #146 POKEMON SIMPLIFIED CHINESE', CS4B],
    ['CGC Pristine 10 Infernape Holo 011/127 Pokémon Simplified Chinese cs5aC', ['CS5aC', 'CS5a']],
    // Several cards.
    ['PCG 10 Pokémon Chinese 30th Anniversary Celebration 30thC-131＆150 Gengar 2PC Set', ['30thC']],
    ['Pokemon Chinese CS4b 044/132 2pcs', CS4B],
    ['Pokemon Chaos Rising Pick your card CS4b 044/132 Chinese', CS4B],
    ['Pokemon Entei #018/125 Chinese CS3a Primordial Arts Holo Rare & Reverse Holo', CS3A],
    // No set code: could be any set of that size.
    ['Pokemon Arbok 208/204 AR (NM) Holo Chinese', CS4B],
    // No number that can be read.
    ['2024 POKEMON S.CHINESE CS4b C-POLYCHROMATIC ORIGIN 162 MEW VMAX', CS4B],
    // Another set's code.
    ['Chinese Abomasnow 126/125 cs3a Sword & Shield Character Rare', CS4B],
    ['Chinese Abomasnow 126/125 CS4b cs3a', CS4B],
    // Promos and stamps.
    ['Chinese Promo Card Pokemon Center Sister 341/SV-P 2026 Promo Stamp CS4b', CS4B]
  ])('refuses %s', (title, codes) => {
    expect(parseListing(title, codes, 'zh-hans')).toBeNull()
  })

  it('a code is a whole token', () => {
    expect(parseListing('Chinese Mew 010/100 CS2a', ['CS2C', 'CS2'], 'zh-hans')).toBeNull()
    expect(parseListing('Chinese Mew 010/100 CSV9.5', ['CSV9C', 'CSV9'], 'zh-hans')).toBeNull()
    expect(parseListing('Chinese Mew 010/100 CSV9.', ['CSV9C', 'CSV9'], 'zh-hans')).toEqual({ number: '10', finish: 'plain' })
  })

  it('takes a number right after the code, but not a year', () => {
    expect(parseListing('Chinese Mew CS3a 143 NM', CS3A, 'zh-hans')).toEqual({ number: '143', finish: 'plain' })
    expect(parseListing('Chinese Mew CS3a-143 NM', CS3A, 'zh-hans')).toEqual({ number: '143', finish: 'plain' })
    expect(parseListing('Chinese Mew CS3a 2023 NM', CS3A, 'zh-hans')).toBeNull()
  })

  it('refuses two different numbers', () => {
    expect(parseListing('Chinese Mew #012 013/125 CS3a', CS3A, 'zh-hans')).toBeNull()
  })

  it('reads finishes, and refuses a title naming two', () => {
    expect(listingFinish('Snivy Poke Ball Pattern')).toBe('ball')
    expect(listingFinish('Snivy Pokeball Mirror')).toBe('ball')
    expect(listingFinish('Snivy Master Ball Holo')).toBe('master')
    expect(listingFinish('Snivy Reverse Holo')).toBe('reverse')
    expect(listingFinish('Snivy Expansion Stamp')).toBe('logo')
    expect(listingFinish('Snivy Holo')).toBe('holo')
    expect(listingFinish('Snivy NM')).toBe('plain')
    expect(listingFinish('Snivy Master Ball Poke Ball')).toBeNull()
  })

  it('an expansion stamp is a finish, any other stamp another printing', () => {
    expect(parseListing('Chinese Ponyta CBB4C-0106 Expansion Stamp', ['CBB4C', 'CBB4'], 'zh-hans')).toEqual({
      number: '106',
      finish: 'logo'
    })
    expect(parseListing('Chinese Ponyta CBB4C-0106 Stamp', ['CBB4C', 'CBB4'], 'zh-hans')).toBeNull()
  })
})

describe('nameOk', () => {
  it('needs the species, tags aside', () => {
    expect(nameOk('Chinese Gengar Vmax CS4B', 'Gengar VMAX', null, 'CS4bC')).toBe(true)
    expect(nameOk('Chinese GALARIAN ZAPDOS V', 'Galarian Zapdos V', null, 'CS3aC')).toBe(true)
    expect(nameOk('Chinese Ho-oh', 'Ho-Oh', null, 'CS3aC')).toBe(true)
    expect(nameOk('Flabébé CS3a', 'Flabebe', null, 'CS3aC')).toBe(true)
  })
  it('a longer name is not the card', () => {
    expect(nameOk('Chinese Mewtwo V', 'Mew', null, 'CS4bC')).toBe(false)
    expect(nameOk('Chinese Zapdos V', 'Galarian Zapdos V', null, 'CS3aC')).toBe(false)
  })
  it('takes the Chinese name', () => {
    expect(nameOk('CSV5C 074 红腿鹬', 'Flamigo', '红腿鹬', 'CSV5C')).toBe(true)
    expect(nameOk('CSV5C 074 铁辙迹', 'Iron Treads ex', '铁辙迹ex', 'CSV5C')).toBe(true)
  })
  it('a card the catalog can not name never matches on its placeholder', () => {
    expect(nameOk('CSV5C 004 Chinese', 'CSV5C 004', null, 'CSV5C')).toBe(false)
  })
})

describe('pokemonSetPrices', () => {
  const p = (id: number, version: string, code = 'CS3aC 017', name = 'Blipbug'): SetPrinting => ({
    id,
    code,
    version,
    name,
    localName: null
  })
  const listings = (title: string, prices: number[], seller?: string): PokemonListing[] =>
    prices.map((price, i) => ({ title, price, seller: seller ?? `seller${i}` }))
  const prices = (items: PokemonListing[], printings: SetPrinting[]): Record<number, unknown> =>
    Object.fromEntries(pokemonSetPrices(items, printings, 'CS3aC', 'zh-hans'))

  const PLAIN = 'Chinese Blipbug 017/122 CS3a NM'

  it('needs MIN_SELLERS', () => {
    expect(MIN_SELLERS).toBe(3)
    expect(prices(listings(PLAIN, [2, 3]), [p(1, 'Normal')])).toEqual({})
    expect(prices(listings(PLAIN, [2, 3, 4]), [p(1, 'Normal')])).toEqual({ 1: { price: 3, listingCount: 3 } })
  })

  it('counts one seller once, at their cheapest', () => {
    const one = listings(PLAIN, [2, 2.5, 3, 3.5, 4], 'dealer')
    expect(prices(one, [p(1, 'Normal')])).toEqual({})
    const items = [...one, ...listings(PLAIN, [3, 4], 'b'), ...listings(PLAIN, [6], 'c')]
    expect(prices(items, [p(1, 'Normal')])).toEqual({ 1: { price: 3, listingCount: 3 } })
  })

  it('outliers leave the price and the count', () => {
    expect(prices(listings(PLAIN, [2, 3, 4, 300]), [p(1, 'Normal')])).toEqual({ 1: { price: 3, listingCount: 3 } })
    // Three sellers, one far off: two left is too few.
    expect(prices(listings(PLAIN, [2, 3, 300]), [p(1, 'Normal')])).toEqual({})
  })

  it('a card joins by name too: the wrong species at the number counts for nothing', () => {
    expect(prices(listings('Chinese Entei 017/122 CS3a NM', [2, 3, 4]), [p(1, 'Normal')])).toEqual({})
  })

  it('a mislabelled set code is caught by the name (a real title: this Blastoise is CS3b)', () => {
    const items = listings('Chinese Blastoise VMAX 026/122 cs3a Primordial Arts RRR Holo - NM', [8, 9, 10])
    expect(prices(items, [p(1, 'Holofoil', 'CS3aC 026', 'Luvdisc')])).toEqual({})
  })

  it('a number the set lacks prices nothing', () => {
    expect(prices(listings('Chinese Blipbug 099/122 CS3a NM', [2, 3, 4]), [p(1, 'Normal')])).toEqual({})
  })

  it('a Normal takes no title saying holo; a Holofoil takes plain and holo', () => {
    const holo = listings('Chinese Blipbug 017/122 CS3a Holo', [2, 3, 4])
    expect(prices(holo, [p(1, 'Normal')])).toEqual({})
    expect(prices(holo, [p(1, 'Holofoil')])).toEqual({ 1: { price: 3, listingCount: 3 } })
    expect(prices(listings(PLAIN, [2, 3, 4]), [p(1, 'Holofoil')])).toEqual({ 1: { price: 3, listingCount: 3 } })
  })

  it('keeps a mirror apart from the plain card', () => {
    const items = [
      ...listings(PLAIN, [1, 1, 1]),
      ...listings('Chinese Blipbug 017/122 CS3a Poke Ball Pattern', [8, 9, 10], undefined).map((l) => ({
        ...l,
        seller: `b${l.price}`
      }))
    ]
    expect(prices(items, [p(1, 'Normal'), p(2, 'Poke Ball Pattern')])).toEqual({
      1: { price: 1, listingCount: 3 },
      2: { price: 9, listingCount: 3 }
    })
  })

  it('a finish the card lacks prices nothing', () => {
    const items = listings('Chinese Blipbug 017/122 CS3a Master Ball', [8, 9, 10])
    expect(prices(items, [p(1, 'Normal'), p(2, 'Poke Ball Pattern')])).toEqual({})
  })

  it('a plain title on a card with Normal and Holofoil could be either', () => {
    expect(prices(listings(PLAIN, [2, 3, 4]), [p(1, 'Normal'), p(2, 'Holofoil')])).toEqual({})
  })

  it('a version with no reading stays unpriced', () => {
    expect(prices(listings(PLAIN, [2, 3, 4]), [p(1, 'Staff Stamp')])).toEqual({})
  })

  it('leaves listings with no seller out', () => {
    expect(prices(listings(PLAIN, [2, 3, 4], ''), [p(1, 'Normal')])).toEqual({})
  })
})

describe('the Pokémon sweep', () => {
  let db: Database.Database
  const PKM_CARD = 2 ** 40 + 1
  let nextCard = PKM_CARD
  const ids: Record<string, number> = {}

  function card(name: string, localName: string | null = null): number {
    const id = nextCard++
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at) VALUES (?, 'pkm', ?, 'Pokémon', 'pokemon', '', '', '')`
    ).run(id, name)
    db.prepare(`INSERT INTO pokemon_cards (card_id, category, types, source_id, local_name) VALUES (?, 'Pokemon', '[]', ?, ?)`).run(
      id,
      `zh-hans/${id}`,
      localName
    )
    return id
  }
  function printing(tag: string, cardId: number, code: string, version: string, lang = 'zh-hans', setName = 'Set'): void {
    const r = db
      .prepare(`INSERT INTO card_printings (game, card_id, set_name, set_code, set_rarity, language) VALUES ('pkm', ?, ?, ?, ?, ?)`)
      .run(cardId, setName, code, version, lang)
    ids[tag] = Number(r.lastInsertRowid)
  }
  function ygoPrefix(key: string, swept: string | null): void {
    db.prepare('INSERT INTO price_sweeps (key, language, swept_at) VALUES (?, ?, ?)').run(key, 'ja', swept)
  }
  function pokemonSet(set: string, swept: string | null = null): void {
    db.prepare('INSERT INTO price_sweeps (key, language, swept_at) VALUES (?, ?, ?)').run(`pkm:${set}`, 'zh-hans', swept)
  }
  const row = (tag: string): { price: number; listing_count: number } | undefined =>
    db.prepare('SELECT price, listing_count FROM intl_prices WHERE printing_id = ?').get(ids[tag]) as never
  /** Sets swept yesterday: the queue is spread over days, and these let two sets run in a day. */
  function padQueue(): void {
    for (let i = 0; i < 10; i++) pokemonSet(`DONE${i}C`, ago(1))
  }
  const swept = (set: string): string | null =>
    (db.prepare(`SELECT swept_at FROM price_sweeps WHERE key = ?`).get(`pkm:${set}`) as { swept_at: string | null }).swept_at

  function fakeClient(
    remaining: number | null = 4000,
    impl?: (codes: string[], lang: string) => Promise<PokemonListings>
  ) {
    const pokemonListings = vi.fn(impl ?? (async () => ({ items: [], calls: 2, checkedAt: NOW.toISOString() })))
    const set = vi.fn(async () => ({ codes: {}, calls: 1, checkedAt: NOW.toISOString() }))
    const quota = vi.fn(async () => ({ remaining }))
    return { client: { set, quota, pokemonListings } as unknown as SweepClient, pokemonListings, set, quota }
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    nextCard = PKM_CARD
    printing('blipbug', card('Blipbug'), 'CS3aC 017', 'Normal', 'zh-hans', 'Primordial Arts: Lush')
    printing('c30', card('Lugia'), '30thC 142/103', 'Holofoil', 'zh-hans', '30th Celebration')
    printing('mp', card('Mega Promo'), 'MP 001', 'Holofoil', 'zh-hans', 'Mega Evolution Promo Card')
    printing('ja', card('Pikachu'), 'SV2D 030/071', 'Normal', 'ja', 'Clay Burst')
  })

  describe('refreshPokemonQueue', () => {
    it('lists Chinese sets once a day under pkm: keys, by set, leaving out ones too short to search', () => {
      expect(refreshPokemonQueue(db, NOW)).toBe(2)
      expect(refreshPokemonQueue(db, new Date(NOW.getTime() + 1000))).toBe(0)
      const keys = (db.prepare('SELECT key, language FROM price_sweeps ORDER BY key').all() as { key: string }[])
      expect(keys).toEqual([
        { key: 'pkm:30thC', language: 'zh-hans' },
        { key: 'pkm:CS3aC', language: 'zh-hans' }
      ])
    })

    it('Traditional lists itself once the catalog has it', () => {
      printing('hant', card('Mew'), 'SV8aF 010/100', 'Normal', 'zh-hant')
      refreshPokemonQueue(db, NOW)
      expect(db.prepare(`SELECT key FROM price_sweeps WHERE language = 'zh-hant'`).all()).toEqual([{ key: 'pkm:SV8aF' }])
    })

    it('marks a set with a live entry as owned', () => {
      db.prepare(`INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (1, 'd', 'u', '', '')`).run()
      db.prepare(`INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'pkm', ?, 0)`).run(PKM_CARD, PKM_CARD)
      db.prepare(
        `INSERT INTO collection_entries (user_id, uid, game, printing_id, image_id, quantity, created_at, updated_at, server_seq) VALUES (1, 'u', 'pkm', ?, ?, 1, '', '', 2)`
      ).run(ids.blipbug, PKM_CARD)
      refreshPokemonQueue(db, NOW)
      const owned = db.prepare(`SELECT key, owned FROM price_sweeps ORDER BY key`).all()
      expect(owned).toEqual([
        { key: 'pkm:30thC', owned: 0 },
        { key: 'pkm:CS3aC', owned: 1 }
      ])
    })
  })

  describe('assignPokemonSweep', () => {
    const good = (price: number): PokemonListings => ({
      items: [price, price + 1, price + 2].map((p, i) => ({
        title: 'Chinese Blipbug 017/122 CS3a NM',
        price: p,
        seller: `s${i}`
      })),
      calls: 2,
      checkedAt: NOW.toISOString()
    })

    it('writes the price and stamps the set', () => {
      pokemonSet('CS3aC')
      expect(assignPokemonSweep(db, 'CS3aC', 'zh-hans', good(2), NOW)).toEqual({ priced: 1 })
      expect(row('blipbug')).toEqual({ price: 3, listing_count: 3 })
      expect(swept('CS3aC')).toBe(NOW.toISOString())
    })

    it('never erases', () => {
      pokemonSet('CS3aC')
      assignPokemonSweep(db, 'CS3aC', 'zh-hans', good(2), NOW)
      assignPokemonSweep(db, 'CS3aC', 'zh-hans', { items: [], calls: 1 }, NOW)
      expect(row('blipbug')).toEqual({ price: 3, listing_count: 3 })
    })

    it('stays in its language and leaves a market price alone', () => {
      printing('other', nextCard - 1, 'CS3aC 017', 'Normal', 'ja', 'Other')
      printing('marketed', card('Blipbug'), 'CS3aC 018', 'Normal')
      db.prepare('UPDATE card_printings SET market_price = 5 WHERE id = ?').run(ids.marketed)
      pokemonSet('CS3aC')
      assignPokemonSweep(db, 'CS3aC', 'zh-hans', good(2), NOW)
      expect(row('other')).toBeUndefined()
      expect(row('marketed')).toBeUndefined()
    })

    it('never prices a Yu-Gi-Oh! printing sharing the code', () => {
      db.prepare(`INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES (1, 'Blipbug', 'Monster', 'normal', 'Warrior', '', '')`).run()
      const r = db
        .prepare(`INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (1, 'Y', 'CS3aC 017', 'Normal', 'zh-hans')`)
        .run()
      ids.ygo = Number(r.lastInsertRowid)
      pokemonSet('CS3aC')
      assignPokemonSweep(db, 'CS3aC', 'zh-hans', good(2), NOW)
      expect(row('ygo')).toBeUndefined()
      expect(row('blipbug')).toBeDefined()
    })

    it('plans on the set-code index without stats', () => {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${POKEMON_PRINTINGS_SQL}`).all('zh-hans', 'CS3aC %') as { detail: string }[]
      expect(plan.map((r) => r.detail).join('\n')).toContain('idx_printings_set_code')
    })
  })

  describe('runPokemonSweep', () => {
    beforeEach(padQueue)

    it('is off by default: no queue, no quota call, no spend', async () => {
      const { client, quota, pokemonListings } = fakeClient()
      expect(await runPokemonSweep(db, client, NOW, 0)).toEqual({ swept: 0, calls: 0 })
      expect(db.prepare(`SELECT COUNT(*) AS n FROM price_sweeps WHERE key = 'pkm:CS3aC'`).get()).toEqual({ n: 0 })
      expect(quota).not.toHaveBeenCalled()
      expect(pokemonListings).not.toHaveBeenCalled()
    })

    it('does nothing without a client', async () => {
      expect(await runPokemonSweep(db, null, NOW, 100)).toEqual({ swept: 0, calls: 0 })
    })

    it('sweeps sets by their code forms and counts on the shared day', async () => {
      const { client, pokemonListings } = fakeClient()
      setMeta(db, 'sweep_calls_day', '2026-10-28:7')
      expect(await runPokemonSweep(db, client, NOW, 100)).toEqual({ swept: 2, calls: 4 })
      expect(pokemonListings.mock.calls.map((c) => c[0]).sort()).toEqual([['30thC'], ['CS3aC', 'CS3a']])
      expect(getMeta(db, 'sweep_calls_day')).toBe('2026-10-28:11')
      expect(getMeta(db, 'sweep_pokemon_day')).toBe('2026-10-28:4:2')
    })

    it('waits while any Yu-Gi-Oh! prefix is due', async () => {
      ygoPrefix('CORI-JP', null)
      const { client, pokemonListings, quota } = fakeClient()
      expect(await runPokemonSweep(db, client, NOW, 100)).toEqual({ swept: 0, calls: 0 })
      expect(pokemonListings).not.toHaveBeenCalled()
      expect(quota).not.toHaveBeenCalled()
    })

    it('leaves all that Yu-Gi-Oh! prefixes coming due today could cost', async () => {
      for (let i = 0; i < 400; i++) ygoPrefix(`K${i}-JP`, ago(6.6))
      const { client, pokemonListings } = fakeClient(100_000)
      // 400 prefixes at 5 calls is the whole day.
      expect(await runPokemonSweep(db, client, NOW, 100)).toEqual({ swept: 0, calls: 0 })
      expect(pokemonListings).not.toHaveBeenCalled()
      db.prepare(`DELETE FROM price_sweeps WHERE key = 'K0-JP'`).run()
      // 5 calls free: one set's 3.
      expect((await runPokemonSweep(db, client, NOW, 100)).swept).toBe(1)
    })

    it('a prefix due tomorrow reserves nothing today', async () => {
      for (let i = 0; i < 400; i++) ygoPrefix(`K${i}-JP`, ago(6))
      const { client } = fakeClient(100_000)
      expect((await runPokemonSweep(db, client, NOW, 100)).swept).toBe(2)
    })

    it('respects the shared cap', async () => {
      const { client, pokemonListings } = fakeClient()
      setMeta(db, 'sweep_calls_day', `2026-10-28:${SWEEP_DAILY_CALLS - POKEMON_SET_CALLS + 1}`)
      expect((await runPokemonSweep(db, client, NOW, 100)).swept).toBe(0)
      expect(pokemonListings).not.toHaveBeenCalled()
    })

    it('never overruns the shared cap, even when every set costs its most', async () => {
      const { client } = fakeClient(4000, async () => ({ items: [], calls: POKEMON_SET_CALLS }))
      setMeta(db, 'sweep_calls_day', `2026-10-28:${SWEEP_DAILY_CALLS - POKEMON_SET_CALLS}`)
      expect((await runPokemonSweep(db, client, NOW, 100)).swept).toBe(1)
      expect(getMeta(db, 'sweep_calls_day')).toBe(`2026-10-28:${SWEEP_DAILY_CALLS}`)
    })

    it('respects its own daily calls', async () => {
      const { client, pokemonListings } = fakeClient(4000, async () => ({ items: [], calls: 3 }))
      expect((await runPokemonSweep(db, client, NOW, POKEMON_SET_CALLS)).swept).toBe(1)
      pokemonListings.mockClear()
      await runPokemonSweep(db, client, NOW, POKEMON_SET_CALLS)
      expect(pokemonListings).not.toHaveBeenCalled()
    })

    it('spreads the queue: a week of sets a day, a batch an alarm', async () => {
      for (let i = 0; i < 40; i++) printing(`s${i}`, card('X'), `CSVX${i}C 001`, 'Normal')
      const { client, pokemonListings } = fakeClient(4000, async () => ({ items: [], calls: 1 }))
      await runPokemonSweep(db, client, NOW, 200)
      expect(pokemonListings).toHaveBeenCalledTimes(POKEMON_SWEEP_BATCH)
      for (let i = 1; i < 6; i++) await runPokemonSweep(db, client, new Date(NOW.getTime() + i * 1000), 200)
      // 52 sets over 6 days.
      expect(pokemonListings).toHaveBeenCalledTimes(9)
      await runPokemonSweep(db, client, new Date(NOW.getTime() + DAY), 200)
      expect(pokemonListings).toHaveBeenCalledTimes(9 + POKEMON_SWEEP_BATCH)
    })

    it('stands down at the reserve, with room for its own calls', async () => {
      const { client, pokemonListings } = fakeClient(SWEEP_RESERVE + 2 * POKEMON_SET_CALLS)
      expect((await runPokemonSweep(db, client, NOW, 100)).swept).toBe(0)
      expect(pokemonListings).not.toHaveBeenCalled()
    })

    it('stands down when the quota is unknown, unlike Yu-Gi-Oh!', async () => {
      const { client, pokemonListings } = fakeClient(null)
      expect((await runPokemonSweep(db, client, NOW, 100)).swept).toBe(0)
      expect(pokemonListings).not.toHaveBeenCalled()
    })

    it('a rate limit stops it for the day without touching Yu-Gi-Oh!', async () => {
      const { client, pokemonListings } = fakeClient(4000, async () => {
        throw new SweepRateLimited()
      })
      await runPokemonSweep(db, client, NOW, 100)
      expect(pokemonListings).toHaveBeenCalledTimes(1)
      expect(getMeta(db, 'sweep_calls_day')).toBe('2026-10-28:0')
      pokemonListings.mockClear()
      await runPokemonSweep(db, client, new Date(NOW.getTime() + 1000), 100)
      expect(pokemonListings).not.toHaveBeenCalled()
    })

    it('a failing set backs off and the next still runs', async () => {
      const { client } = fakeClient(4000, async (codes) => {
        if (codes[0] === '30thC') throw new Error('502')
        return { items: [], calls: 1 }
      })
      expect(await runPokemonSweep(db, client, NOW, 100)).toEqual({ swept: 1, calls: 2 })
      expect(swept('30thC')).toBe(ago(6))
      expect(swept('CS3aC')).toBe(NOW.toISOString())
    })

    it('a swept set is not due for a week', async () => {
      const { client, pokemonListings } = fakeClient()
      await runPokemonSweep(db, client, NOW, 100)
      pokemonListings.mockClear()
      await runPokemonSweep(db, client, new Date(NOW.getTime() + 6 * DAY), 100)
      expect(pokemonListings).not.toHaveBeenCalled()
      await runPokemonSweep(db, client, new Date(NOW.getTime() + 7 * DAY + 1000), 100)
      expect(pokemonListings).toHaveBeenCalledTimes(2)
    })
  })

  describe('leaves Yu-Gi-Oh! alone', () => {
    it('its sweep neither sees nor is held up by Pokémon rows', async () => {
      pokemonSet('CS3aC')
      pokemonSet('30thC')
      ygoPrefix('CORI-JP', null)
      const { client, set, pokemonListings } = fakeClient()
      const out = await runSweep(db, client, NOW)
      expect(set.mock.calls).toEqual([['CORI-JP', 'ja']])
      expect(pokemonListings).not.toHaveBeenCalled()
      // Pokémon rows still due don't read as more Yu-Gi-Oh! work, or the alarm would run every minute.
      expect(out).toEqual({ swept: 1, calls: 1, more: false })
    })

    it('its daily listing never adds Pokémon', () => {
      expect(refreshSweepQueue(db, NOW)).toBe(0)
    })

    const storage = () => {
      let alarm: number | null = null
      return {
        getAlarm: async () => alarm,
        setAlarm: async (t: number) => void (alarm = t),
        at: () => alarm
      }
    }

    it('the alarm stays dark without the setting', async () => {
      const { client, pokemonListings } = fakeClient()
      await runPriceAlarm(db, null, storage(), () => NOW, client)
      expect(pokemonListings).not.toHaveBeenCalled()
      expect(getMeta(db, 'price_sweeps_pkm_listed_at')).toBeNull()
    })

    it('with the setting on the alarm sweeps Pokémon but keeps its idle pace', async () => {
      padQueue()
      const { client, pokemonListings } = fakeClient()
      const s = storage()
      await runPriceAlarm(db, null, s, () => NOW, client, { pokemonDailyCalls: 100 })
      expect(pokemonListings).toHaveBeenCalledTimes(2)
      expect(s.at()).toBe(NOW.getTime() + 21_600_000)
    })
  })

  describe('sweepClientFor', () => {
    it('asks the Worker by code forms and language, and reads a 429', async () => {
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
      expect((await c.pokemonListings(['CS3aC', 'CS3a'], 'zh-hans')).items).toHaveLength(1)
      expect(urls[0]).toBe('https://p.test/v1/pokemon-listings?codes=CS3aC%2CCS3a&lang=zh-hans')
      await expect(c.pokemonListings(['RATE'], 'zh-hans')).rejects.toBeInstanceOf(SweepRateLimited)
      await expect(c.pokemonListings(['BAD'], 'zh-hans')).rejects.toThrow('unexpected')
    })
  })
})
