import { describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { SHARED_SET_NAME, seedPokemon } from '../fixtures/pokemon'
import { findPokemonSetArtUrl, getChecklist, listSets } from '../../src/main/repo/sets'
import { getMeta } from '../../src/main/db/meta'
import {
  BULBAGARDEN_API,
  bulbagardenKey,
  listCategoryFiles,
  matchLogos,
  matchPacks,
  pokemontcgKey,
  refreshPokemonSetArt,
  shouldRefreshSetArt,
  warmSetArt,
  type ArchiveFile,
  type SetRow
} from '../../scripts/catalog/pokemon/setArt'

const UP = 'https://archives.bulbagarden.net/media/upload/'
const file = (title: string, width = 780, height = 1429): ArchiveFile => ({
  title,
  url: `${UP}a/ab/${title.replace(/ /g, '_')}`,
  width,
  height
})
const set = (
  set_name: string,
  set_code: string,
  image_key: string | null,
  image_url: string | null = null
): SetRow => ({
  set_name,
  set_code,
  image_key,
  image_url
})

const setGame = (db: Database.Database, game: string | null): void => {
  db.prepare("DELETE FROM meta WHERE key = 'active_game'").run()
  if (game) db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', ?)").run(game)
}

describe('matching Bulbagarden pack files to sets', () => {
  const en = [
    set('Scarlet & Violet', 'SVI', 'td-en-sv01'),
    set('Black Bolt', 'BLK', 'td-en-sv10_5b'),
    set('Brilliant Stars', 'BRS', 'td-en-swsh9'),
    set('Brilliant Stars Trainer Gallery', 'BRS:TG', 'td-en-swsh9tg'),
    set('Base Set', 'BS', 'td-en-base1'),
    set('Base Set 2', 'B2', 'td-en-base4'),
    set("Champion's Path", 'CPA', 'td-en-swsh3_5'),
    set('Poké Card Creator Pack', 'EX5.5', 'td-en-ex5_5'),
    set('XY trainer Kit (Noivern)', 'TK6N', 'td-en-tk-xy-n')
  ]

  it('reads English codes as TCGdex ids and names as set names, largest design first', () => {
    const { art, unmatchedFiles } = matchPacks(
      'en',
      [
        file('SV1 Booster Koraidon.png', 700, 1280),
        file('SV1 Booster Miraidon.png'),
        file('SV10.5 BLK Booster EN.png'),
        file('SWSH9 Booster Arceus.jpg'),
        file('Base Set 2 Booster Pidgeot.jpg'),
        file('Base Set Booster Charizard Long.jpg'),
        file('Champion Path Booster Gardevoir.jpg', 187, 343),
        file('Poké Card Creator Pack front.png', 301, 556),
        file('Poké Card Creator Pack reverse.png', 301, 556),
        file('PPS1 pack.png', 775, 426),
        file('Trick or Trade 2022 pack.jpg')
      ],
      en
    )
    const titles = (name: string): string[] | undefined => art.get(name)?.map((f) => f.title)
    expect(titles('Scarlet & Violet')).toEqual([
      'SV1 Booster Miraidon.png',
      'SV1 Booster Koraidon.png'
    ])
    expect(titles('Black Bolt')).toEqual(['SV10.5 BLK Booster EN.png'])
    expect(titles('Base Set 2')).toEqual(['Base Set 2 Booster Pidgeot.jpg'])
    expect(titles('Base Set')).toEqual(['Base Set Booster Charizard Long.jpg'])
    expect(titles("Champion's Path")).toEqual(['Champion Path Booster Gardevoir.jpg'])
    expect(titles('Poké Card Creator Pack')).toEqual(['Poké Card Creator Pack front.png'])
    // A subset comes in its parent's packs; a trainer kit has no booster.
    expect(titles('Brilliant Stars Trainer Gallery')).toEqual(['SWSH9 Booster Arceus.jpg'])
    expect(art.has('XY trainer Kit (Noivern)')).toBe(false)
    // The landscape prize pack isn't a wrapper; a back matches no set.
    expect(unmatchedFiles).toEqual([
      'Poké Card Creator Pack reverse.png',
      'Trick or Trade 2022 pack.jpg'
    ])
  })

  it('reads Japanese codes loosely, falls back to names, and skips other languages', () => {
    const ja = [
      set('Raging Surf', 'SV3A', 'td-ja-SV3a'),
      set('サン＆ムーン', 'SM1+', 'td-ja-SM1_'),
      set('Black Bolt', 'SV11B', 'td-ja-SV11B'),
      set('コレクションX', 'XY1A', 'td-ja-XY1a'),
      set('強化拡張パックex1マグマVSアクア ふたつの野望', 'ADV4', 'td-ja-ADV4'),
      set('とかれた封印', 'ADV5', 'td-ja-ADV5'),
      set('Pokemon Jungle', 'PMCG2', 'td-ja-PMCG2'),
      set('Expansion Pack', 'PMCG1', 'td-ja-PMCG1'),
      set('ロケット団の逆襲', 'PCG3', 'td-ja-PCG3')
    ]
    const { art } = matchPacks(
      'ja',
      [
        file('SV3a Raging Surf pack.jpg'),
        file('SV3a F pack.png'),
        file('SV2D pack K.png'),
        file('SM1Plus pack.jpg'),
        file('SV11 Black Bolt pack.png', 402, 808),
        file('SV11 Black Bolt pack Deluxe.png', 374, 734),
        file('XY1 Collection X pack.jpg'),
        file('ADV4 Undone Seal pack.jpg'),
        file('Ex1 Magma VS Aqua Two Ambitions pack.jpg'),
        file('Pokémon Jungle pack.jpg'),
        file('Expansion Pack pack.jpg'),
        file('PCG3 Rocket Gang Strikes Back pack.jpg'),
        file('Base Set Booster Charizard DE.jpg'),
        file('AS1a First Impact Booster Thai.jpg')
      ],
      ja
    )
    const titles = (name: string): string[] | undefined => art.get(name)?.map((f) => f.title)
    expect(titles('Raging Surf')).toEqual(['SV3a Raging Surf pack.jpg'])
    expect(titles('サン＆ムーン')).toEqual(['SM1Plus pack.jpg'])
    expect(titles('Black Bolt')).toEqual([
      'SV11 Black Bolt pack.png',
      'SV11 Black Bolt pack Deluxe.png'
    ])
    expect(titles('コレクションX')).toEqual(['XY1 Collection X pack.jpg'])
    expect(titles('強化拡張パックex1マグマVSアクア ふたつの野望')).toEqual([
      'Ex1 Magma VS Aqua Two Ambitions pack.jpg'
    ])
    expect(titles('とかれた封印')).toEqual(['ADV4 Undone Seal pack.jpg'])
    expect(titles('Pokemon Jungle')).toEqual(['Pokémon Jungle pack.jpg'])
    expect(titles('Expansion Pack')).toEqual(['Expansion Pack pack.jpg'])
    expect(titles('ロケット団の逆襲')).toEqual(['PCG3 Rocket Gang Strikes Back pack.jpg'])
  })

  it('takes Pokémon TCG API logos only for sets TCGdex has none for', () => {
    const logos = matchLogos(
      [
        {
          id: 'sm35',
          name: 'Shining Legends',
          images: { logo: 'https://images.pokemontcg.io/sm35/logo.png' }
        },
        {
          id: 'sv1',
          name: 'Scarlet & Violet',
          images: { logo: 'https://images.pokemontcg.io/sv1/logo.png' }
        },
        {
          id: 'tk1a',
          name: 'EX Trainer Kit Latias',
          images: { logo: 'https://images.pokemontcg.io/tk1a/logo.png' }
        },
        { id: 'x', name: 'Elsewhere', images: { logo: 'https://example.com/logo.png' } }
      ],
      [
        set('Shining Legends', 'SLG', 'td-en-sm3_5'),
        set('Scarlet & Violet', 'SVI', 'td-en-sv01', 'https://assets.tcgdex.net/en/sv/sv01/logo'),
        set('EX trainer Kit (Latias)', 'TK1A', 'td-en-tk-ex-latia'),
        set('Elsewhere', 'X', 'td-en-x')
      ]
    )
    expect([...logos]).toEqual([
      ['Shining Legends', 'https://images.pokemontcg.io/sm35/logo.png'],
      ['EX trainer Kit (Latias)', 'https://images.pokemontcg.io/tk1a/logo.png']
    ])
  })

  it('takes logos the API keeps on Scrydex, and hand-picked ones the name match misses', () => {
    const scrydex = 'https://images.scrydex.com/pokemon/me3-logo/logo'
    const logos = matchLogos(
      [{ id: 'me3', name: 'Perfect Order', images: { logo: scrydex } }],
      [
        set('Perfect Order', 'POR', 'td-en-me03'),
        set('XY trainer Kit (Latias)', 'XYTK', 'td-en-tk-xy-latia'),
        set('Radiant Collection', 'RC', 'td-en-rc')
      ]
    )
    expect([...logos]).toEqual([
      ['Perfect Order', scrydex],
      ['XY trainer Kit (Latias)', 'https://images.scrydex.com/pokemon/tk6a-logo/logo'],
      ['Radiant Collection', 'https://images.pokemontcg.io/bw11/logo.png']
    ])
    expect(pokemontcgKey(scrydex)).toMatch(/^pt-[0-9a-f]{20}$/)
  })

  it('keys images by their source', () => {
    expect(bulbagardenKey(`${UP}a/ab/X.png`)).toMatch(/^bp-[0-9a-f]{20}$/)
    expect(bulbagardenKey('https://example.com/X.png')).toBeNull()
    expect(pokemontcgKey('https://images.pokemontcg.io/sm35/logo.png')).toMatch(/^pt-[0-9a-f]{20}$/)
    expect(pokemontcgKey(`${UP}a/ab/X.png`)).toBeNull()
  })
})

/** A MediaWiki categorymembers answer with imageinfo. */
const apiPage = (
  members: { title: string; ns: number; w?: number; h?: number }[],
  cont?: Record<string, string>
): unknown => ({
  ...(cont && { continue: cont }),
  query: {
    pages: Object.fromEntries(
      members.map((m, i) => [
        String(i + 1),
        m.ns === 6
          ? {
              ns: 6,
              title: m.title,
              imageinfo: [
                {
                  url: `${UP}a/ab/${m.title.slice(5).replace(/ /g, '_')}`,
                  width: m.w ?? 780,
                  height: m.h ?? 1429
                }
              ]
            }
          : { ns: m.ns, title: m.title }
      ])
    )
  }
})

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/** Fake archive and Pokémon TCG API: English packs in a subcategory, Japanese ones in the flat parent. */
function fakeSources(
  opts: { archiveDown?: boolean; logosFlaky?: number } = {}
): ReturnType<typeof vi.fn> {
  let logoFailures = opts.logosFlaky ?? 0
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    expect(new Headers(init?.headers).get('user-agent')).toMatch(/^DuelBinder\//)
    if (url.origin === 'https://api.pokemontcg.io') {
      if (logoFailures-- > 0) return new Response('busy', { status: 500 })
      return json({
        data: [
          {
            id: 'x',
            name: 'Elsewhere',
            images: { logo: 'https://images.pokemontcg.io/x/logo.png' }
          }
        ]
      })
    }
    if (opts.archiveDown) return new Response('down', { status: 503 })
    const cat = url.searchParams.get('gcmtitle')
    if (cat === 'Category:English TCG packs') {
      if (!url.searchParams.get('gcmcontinue')) {
        return json(
          apiPage([{ ns: 14, title: 'Category:English Scarlet & Violet Series packs' }], {
            gcmcontinue: 'next',
            continue: 'gcmcontinue||'
          })
        )
      }
      return json(apiPage([{ ns: 6, title: 'File:E-Reader Sample Pack.jpg' }]))
    }
    if (cat === 'Category:English Scarlet & Violet Series packs') {
      return json(
        apiPage([
          { ns: 6, title: 'File:SV1 Booster Koraidon.png' },
          { ns: 6, title: 'File:SV1 Booster Miraidon.png', w: 700, h: 1280 }
        ])
      )
    }
    if (cat === 'Category:Japanese TCG packs') return json(apiPage([]))
    if (cat === 'Category:TCG booster packs') {
      expect(url.searchParams.get('gcmtype')).toBe('file')
      return json(
        apiPage([
          { ns: 6, title: 'File:SV2D Clay Burst pack.png' },
          { ns: 14, title: 'Category:Korean TCG packs' }
        ])
      )
    }
    throw new Error(`unexpected ${url}`)
  })
}

async function pokemonDb(): Promise<Database.Database> {
  const db = await seededDb()
  seedPokemon(db)
  db.prepare(
    "UPDATE sets SET image_key = 'td-en-sv01', image_url = 'https://assets.tcgdex.net/en/sv/sv01/logo' WHERE game = 'pkm' AND language = 'en'"
  ).run()
  db.prepare(
    "UPDATE sets SET image_key = 'td-ja-SV2D' WHERE game = 'pkm' AND language = 'ja'"
  ).run()
  return db
}

describe('the job step', () => {
  const noPause = async (): Promise<void> => {}

  it('walks category trees page by page, flat when asked', async () => {
    const fetchFn = fakeSources()
    const files = await listCategoryFiles('Category:English TCG packs', {
      fetch: fetchFn as unknown as typeof fetch,
      userAgent: 'DuelBinder/test',
      pause: noPause,
      retryDelayMs: 1
    })
    expect(files.map((f) => f.title).sort()).toEqual([
      'E-Reader Sample Pack.jpg',
      'SV1 Booster Koraidon.png',
      'SV1 Booster Miraidon.png'
    ])
    expect(String(fetchFn.mock.calls[0][0])).toContain(BULBAGARDEN_API)
  })

  it('writes every design, the main one first, and stamps the week', async () => {
    const db = await pokemonDb()
    const now = new Date('2026-10-30T06:00:00Z')
    expect(shouldRefreshSetArt(db, now)).toBe(true)
    const report = await refreshPokemonSetArt(db, {
      version: 'test',
      fetch: fakeSources() as unknown as typeof fetch,
      pause: noPause,
      retryDelayMs: 1,
      now
    })
    expect(report.problems).toEqual([])
    expect(report.packs.en).toMatchObject({ matched: 1, sets: 1 })
    expect(report.packs.ja).toMatchObject({ matched: 1, sets: 1 })
    const rows = db
      .prepare(
        'SELECT language, set_name, kind, sort_order, image_url, image_key FROM pokemon_set_art ORDER BY language, sort_order'
      )
      .all() as {
      language: string
      set_name: string
      sort_order: number
      image_url: string
      image_key: string
    }[]
    expect(
      rows.map((r) => [r.language, r.set_name, r.sort_order, r.image_url.split('/').pop()])
    ).toEqual([
      ['en', SHARED_SET_NAME, 0, 'SV1_Booster_Koraidon.png'],
      ['en', SHARED_SET_NAME, 1, 'SV1_Booster_Miraidon.png'],
      ['ja', 'クレイバースト', 0, 'SV2D_Clay_Burst_pack.png']
    ])
    expect(findPokemonSetArtUrl(db, rows[0].image_key)).toBe(rows[0].image_url)
    expect(getMeta(db, 'pkm_set_art_synced_at')).toBe(now.toISOString())
    expect(shouldRefreshSetArt(db, new Date('2026-11-02T06:00:00Z'))).toBe(false)
  })

  it('keeps the stored pack art and leaves the timer when the archive fails', async () => {
    const db = await pokemonDb()
    await refreshPokemonSetArt(db, {
      version: 'test',
      fetch: fakeSources() as unknown as typeof fetch,
      pause: noPause,
      retryDelayMs: 1
    })
    db.prepare("DELETE FROM meta WHERE key = 'pkm_set_art_synced_at'").run()
    const before = db.prepare("SELECT * FROM pokemon_set_art WHERE kind = 'pack'").all()
    const report = await refreshPokemonSetArt(db, {
      version: 'test',
      fetch: fakeSources({ archiveDown: true }) as unknown as typeof fetch,
      pause: noPause,
      retryDelayMs: 1
    })
    expect(report.problems).toEqual([expect.stringMatching(/^Pack art: Bulbagarden .*503/)])
    expect(db.prepare("SELECT * FROM pokemon_set_art WHERE kind = 'pack'").all()).toEqual(before)
    expect(getMeta(db, 'pkm_set_art_synced_at')).toBeNull()
  })

  it('retries a source that answers 500 for a moment', async () => {
    const db = await pokemonDb()
    db.prepare(
      "UPDATE sets SET image_url = NULL, set_name = 'Elsewhere' WHERE game = 'pkm' AND language = 'en'"
    ).run()
    const report = await refreshPokemonSetArt(db, {
      version: 'test',
      fetch: fakeSources({ logosFlaky: 2 }) as unknown as typeof fetch,
      pause: noPause,
      retryDelayMs: 1
    })
    expect(report.problems).toEqual([])
    expect(report.logos).toEqual({ matched: 1, missing: 1, unmatchedSets: [] })
    expect(
      db.prepare("SELECT set_name, image_key FROM pokemon_set_art WHERE kind = 'logo'").all()
    ).toEqual([{ set_name: 'Elsewhere', image_key: expect.stringMatching(/^pt-/) }])
  })

  it('writes nothing on a dry run', async () => {
    const db = await pokemonDb()
    const report = await refreshPokemonSetArt(db, {
      version: 'test',
      fetch: fakeSources() as unknown as typeof fetch,
      pause: noPause,
      retryDelayMs: 1,
      dryRun: true
    })
    expect(report.packs.en.matched).toBe(1)
    expect(db.prepare('SELECT count(*) AS n FROM pokemon_set_art').get()).toEqual({ n: 0 })
  })

  it('warms new keys one at a time, pausing only after upstream fetches', async () => {
    const results = ['stored', 'cached', 'failed', 'cached']
    const fetchFn = vi.fn(async () => json({ result: results.shift() }))
    const pause = vi.fn(noPause)
    const out = await warmSetArt({
      url: 'https://portal.test/',
      token: 't',
      keys: ['bp-1', 'bp-2', 'bp-3', 'bp-4'],
      fetch: fetchFn as unknown as typeof fetch,
      pause
    })
    expect(out).toEqual({ stored: 1, cached: 2, failed: 1 })
    expect(fetchFn).toHaveBeenCalledTimes(4)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://portal.test/admin/img/warm')
    expect(JSON.parse(String(init.body))).toEqual({ path: 'set/bp-1' })
    // After bp-1 (stored) and bp-3 (failed upstream), not after the cached ones.
    expect(pause).toHaveBeenCalledTimes(2)
  })
})

describe('Pokémon set art in set summaries', () => {
  const art = (
    db: Database.Database,
    language: string,
    setName: string,
    kind: string,
    order: number,
    key: string
  ): void => {
    db.prepare(
      'INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(language, setName, kind, order, `${UP}${key}.png`, key)
  }

  it('shows the main pack in front, and a logo only where there is no pack', async () => {
    const db = await seededDb()
    seedPokemon(db)
    db.prepare(
      "UPDATE sets SET image_key = 'td-en-sv02', image_url = 'https://assets.tcgdex.net/en/sv/sv02/logo' WHERE game = 'pkm' AND language = 'en'"
    ).run()
    art(db, 'en', SHARED_SET_NAME, 'pack', 1, 'bp-second')
    art(db, 'en', SHARED_SET_NAME, 'pack', 0, 'bp-main')
    art(db, 'ja', 'クレイバースト', 'logo', 0, 'pt-logo')
    // A Yu-Gi-Oh! pack render for the Yu-Gi-Oh! set of the same name stays Yu-Gi-Oh!'s.
    db.prepare(
      "INSERT INTO pack_art (set_name, image_url, image_key) VALUES (?, 'https://www.yugioh-card.com/en/wp-content/uploads/x.png', 'yc-ygo')"
    ).run(SHARED_SET_NAME)

    setGame(db, 'pkm')
    const sets = listSets(db)
    const en = sets.find((s) => s.language === 'en')!
    expect(en).toMatchObject({
      imageKey: 'td-en-sv02',
      packImageKey: 'bp-main',
      logoImageKey: null
    })
    const ja = sets.find((s) => s.language === 'ja')!
    expect(ja).toMatchObject({ packImageKey: null, logoImageKey: 'pt-logo' })
    expect(getChecklist(db, SHARED_SET_NAME, 'en')?.set.packImageKey).toBe('bp-main')

    db.prepare("DELETE FROM pokemon_set_art WHERE language = 'en'").run()
    expect(listSets(db).find((s) => s.language === 'en')).toMatchObject({
      packImageKey: null,
      logoImageKey: 'td-en-sv02'
    })

    setGame(db, null)
    const ygo = listSets(db).find((s) => s.setName === SHARED_SET_NAME && s.language === 'en')!
    expect(ygo.packImageKey).toBe('yc-ygo')
  })
})
