import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMeta } from '../../src/main/db/meta'
import {
  INTL_INTERVAL_MS,
  normalizeName,
  refreshIntlSets,
  shouldRefreshIntl
} from '../../src/main/sync/intl'
import { yugipediaImageKey } from '../../src/main/images/cache'
import { YugipediaError, type YugipediaClient } from '../../src/main/yugipedia/client'
import { seededDb } from './helpers'

const NOW = new Date('2026-11-01T00:00:00.000Z')

const listPage = (rows: string[], extra = ''): string =>
  `{{Set list|${extra}\n${rows.join('\n')}\n}}`
const infobox = (fields: string): string => `{{Infobox set\n${fields}\n}}`

interface Fake {
  client: YugipediaClient
  pageCalls: string[][]
  lists: string[]
  pages: Map<string, string>
  failCall: number | null
  failListing: boolean
}

function fake(pages: Record<string, string>): Fake {
  const f: Fake = {
    pages: new Map(Object.entries(pages)),
    pageCalls: [],
    lists: Object.keys(pages).filter((t) => t.startsWith('Set Card Lists:')),
    failCall: null,
    failListing: false,
    client: undefined as unknown as YugipediaClient
  }
  f.client = {
    listSetListTitles: async () => {
      if (f.failListing) throw new YugipediaError('boom')
      return f.lists
    },
    fetchPages: async (titles) => {
      const idx = f.pageCalls.length
      f.pageCalls.push(titles)
      if (f.failCall === idx) throw new YugipediaError('chunk failed')
      const out = new Map<string, string>()
      for (const t of titles) if (f.pages.has(t)) out.set(t, f.pages.get(t)!)
      return out
    },
    fetchImageUrls: async (files) =>
      new Map(files.map((n) => [n, `https://ms.yugipedia.com/x/${n}`]))
  }
  return f
}

const LB = 'Set Card Lists:Legend of Blue Eyes White Dragon (OCG-JP)'

function intlRows(db: Database.Database): Record<string, unknown>[] {
  return db
    .prepare(
      `SELECT p.id, c.name, p.language, p.set_name, p.set_code, p.set_rarity, p.missing_from_api
       FROM card_printings p JOIN cards c ON c.id = p.card_id WHERE p.language <> 'en'
       ORDER BY p.set_name, p.set_code, p.set_rarity`
    )
    .all() as Record<string, unknown>[]
}

let db: Database.Database
beforeEach(async () => {
  db = await seededDb()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('refreshIntlSets', () => {
  it('imports a Japanese set as its own set', async () => {
    const englishBefore = db
      .prepare("SELECT * FROM card_printings WHERE language = 'en' ORDER BY id")
      .all()
    const f = fake({
      [LB]: listPage(['LB-05; Dark Magician; UR', 'LB-99; Not A Card; C']),
      'Legend of Blue Eyes White Dragon': infobox(
        '| image = LB-JP.png\n| jp_release_date = March 8, 2002'
      )
    })
    const res = await refreshIntlSets(db, f.client, NOW)
    expect(res).toEqual({ sets: 1, failedSets: 0, unmatchedRows: 1, ok: true })
    const rows = intlRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'Dark Magician',
      language: 'ja',
      set_name: 'Legend of Blue Eyes White Dragon',
      set_code: 'LB-05',
      set_rarity: 'Ultra Rare',
      missing_from_api: 0
    })
    expect(db.prepare("SELECT * FROM sets WHERE language = 'ja'").get()).toMatchObject({
      set_name: 'Legend of Blue Eyes White Dragon',
      set_code: '',
      tcg_date: '2002-03-08',
      image_url: 'https://ms.yugipedia.com/x/LB-JP.png',
      image_key: yugipediaImageKey('https://ms.yugipedia.com/x/LB-JP.png'),
      list_rows: 2,
      unmatched_rows: 1
    })
    expect(
      db.prepare("SELECT * FROM card_printings WHERE language = 'en' ORDER BY id").all()
    ).toEqual(englishBefore)
    expect(getMeta(db, 'intl_sets_synced_at')).toBe(NOW.toISOString())
  })

  it('uses the set page from the list when given', async () => {
    const f = fake({
      [LB]: `{{Set page header|set=LB (Japanese)}}\n` + listPage(['LB-05; Dark Magician; UR']),
      'LB (Japanese)': infobox('| jp_release_date = March 8, 2002')
    })
    await refreshIntlSets(db, f.client, NOW)
    expect(db.prepare("SELECT tcg_date FROM sets WHERE language = 'ja'").get()).toEqual({
      tcg_date: '2002-03-08'
    })
  })

  it('one row with several rarities makes one printing per rarity', async () => {
    const f = fake({ [LB]: listPage(['LB-05; Dark Magician; UR, SR']) })
    await refreshIntlSets(db, f.client, NOW)
    expect(intlRows(db).map((r) => r.set_rarity)).toEqual(['Super Rare', 'Ultra Rare'])
  })

  it("codeless sets don't collide", async () => {
    const f = fake({
      'Set Card Lists:Vol.1 (OCG-JP)': listPage(['Dark Magician; UR'], 'options=noabbr'),
      'Set Card Lists:Vol.2 (OCG-JP)': listPage(['Dark Magician; UR'], 'options=noabbr')
    })
    await refreshIntlSets(db, f.client, NOW)
    expect(intlRows(db).map((r) => [r.set_name, r.set_code])).toEqual([
      ['Vol.1', ''],
      ['Vol.2', '']
    ])
  })

  it('matches names despite case, curly quotes and dashes', async () => {
    const f = fake({
      [LB]: listPage(['A-1; Pot Of Greed; C', 'A-2; Harpie’s Feather Duster; C'])
    })
    const res = await refreshIntlSets(db, f.client, NOW)
    expect(res.unmatchedRows).toBe(0)
    expect(
      intlRows(db)
        .map((r) => r.name)
        .sort()
    ).toEqual(["Harpie's Feather Duster", 'Pot of Greed'])
    expect(normalizeName('  Ａ‐B – C  “x” ‘y’ ')).toBe('a-b - c "x" \'y\'')
  })

  it('skips English and unknown suffixes', async () => {
    const f = fake({
      [LB]: listPage(['LB-05; Dark Magician; UR']),
      'Set Card Lists:Legend of Blue Eyes White Dragon (TCG-EN)': listPage([
        'LOB-EN005; Dark Magician; UR'
      ]),
      'Set Card Lists:Legend of Blue Eyes White Dragon (TCG-NA)': listPage([
        'LOB-E005; Dark Magician; UR'
      ])
    })
    await refreshIntlSets(db, f.client, NOW)
    const fetched = f.pageCalls.flat()
    expect(fetched).toContain(LB)
    expect(fetched.filter((t) => t.includes('TCG-EN') || t.includes('TCG-NA'))).toEqual([])
    expect(intlRows(db)).toHaveLength(1)
  })

  it("a failed chunk keeps that chunk's old rows and does not stamp", async () => {
    const pages: Record<string, string> = {}
    for (let i = 1; i <= 51; i++) {
      pages[`Set Card Lists:S${String(i).padStart(2, '0')} (OCG-JP)`] = listPage([
        `S-${i}; Dark Magician; UR`
      ])
    }
    const first = fake(pages)
    await refreshIntlSets(db, first.client, new Date('2026-10-01T00:00:00.000Z'))
    expect(intlRows(db)).toHaveLength(51)

    pages['Set Card Lists:S01 (OCG-JP)'] = listPage(['S-1; Dark Magician; SR'])
    pages['Set Card Lists:S51 (OCG-JP)'] = listPage(['S-51; Dark Magician; SR'])
    const second = fake(pages)
    second.failCall = 1
    const res = await refreshIntlSets(db, second.client, NOW)
    expect(res.ok).toBe(false)
    expect(res.failedSets).toBe(1)
    const byName = (n: string): unknown[] =>
      intlRows(db)
        .filter((r) => r.set_name === n)
        .map((r) => r.set_rarity)
    expect(byName('S01')).toEqual(['Super Rare'])
    expect(byName('S51')).toEqual(['Ultra Rare'])
    expect(getMeta(db, 'intl_sets_synced_at')).toBe('2026-10-01T00:00:00.000Z')
  })

  it('a page without {{Set list counts as failed and keeps old rows', async () => {
    const f = fake({ [LB]: listPage(['LB-05; Dark Magician; UR']) })
    await refreshIntlSets(db, f.client, new Date('2026-10-01T00:00:00.000Z'))
    f.pages.set(LB, 'Just prose, no list.')
    const res = await refreshIntlSets(db, f.client, NOW)
    expect(res).toMatchObject({ failedSets: 1, ok: false })
    expect(intlRows(db)).toHaveLength(1)
    expect(getMeta(db, 'intl_sets_synced_at')).toBe('2026-10-01T00:00:00.000Z')
  })

  it('listing failure writes nothing', async () => {
    const f = fake({ [LB]: listPage(['LB-05; Dark Magician; UR']) })
    f.failListing = true
    const res = await refreshIntlSets(db, f.client, NOW)
    expect(res.ok).toBe(false)
    expect(intlRows(db)).toHaveLength(0)
    expect(getMeta(db, 'intl_sets_synced_at')).toBeNull()
  })

  it('an owned printing removed upstream is flagged, an unowned one deleted', async () => {
    const f = fake({ [LB]: listPage(['LB-05; Dark Magician; UR, SR']) })
    await refreshIntlSets(db, f.client, NOW)
    const owned = db
      .prepare(
        "SELECT id, card_id FROM card_printings WHERE set_rarity = 'Ultra Rare' AND language = 'ja'"
      )
      .get() as { id: number; card_id: number }
    const imageId = (
      db.prepare('SELECT image_id FROM card_images WHERE card_id = ?').get(owned.card_id) as {
        image_id: number
      }
    ).image_id
    db.prepare(
      "INSERT INTO collection_entries (printing_id, image_id, quantity, created_at, updated_at) VALUES (?, ?, 1, 'x', 'x')"
    ).run(owned.id, imageId)
    f.pages.set(LB, listPage(['LB-05; Pot of Greed; C']))
    await refreshIntlSets(db, f.client, NOW)
    const rows = intlRows(db)
    expect(rows.find((r) => r.id === owned.id)).toMatchObject({ missing_from_api: 1 })
    expect(rows.filter((r) => r.set_rarity === 'Super Rare')).toHaveLength(0)
    expect(rows.find((r) => r.name === 'Pot of Greed')).toMatchObject({ missing_from_api: 0 })
  })

  it('a set gone upstream is removed only after a clean run', async () => {
    const V2 = 'Set Card Lists:Vol.2 (OCG-JP)'
    const f = fake({
      [LB]: listPage(['LB-05; Dark Magician; UR']),
      [V2]: listPage(['V-1; Pot of Greed; C'])
    })
    await refreshIntlSets(db, f.client, NOW)
    expect(db.prepare("SELECT count(*) AS n FROM sets WHERE language = 'ja'").get()).toEqual({
      n: 2
    })

    // Unclean run: LB's page is broken, Vol.2 is gone from the listing. Nothing is removed.
    f.lists = [LB]
    f.pages.set(LB, 'broken')
    await refreshIntlSets(db, f.client, NOW)
    expect(db.prepare("SELECT count(*) AS n FROM sets WHERE language = 'ja'").get()).toEqual({
      n: 2
    })
    expect(intlRows(db)).toHaveLength(2)

    // Clean run: Vol.2 is removed.
    f.pages.set(LB, listPage(['LB-05; Dark Magician; UR']))
    await refreshIntlSets(db, f.client, NOW)
    expect(db.prepare("SELECT set_name FROM sets WHERE language = 'ja'").all()).toEqual([
      { set_name: 'Legend of Blue Eyes White Dragon' }
    ])
    expect(intlRows(db)).toHaveLength(1)
  })

  it('never touches English sets', async () => {
    db.prepare(
      "INSERT INTO sets (language, set_name, set_code) VALUES ('en', 'Legend of Blue Eyes White Dragon', 'LOB')"
    ).run()
    const f = fake({ [LB]: listPage(['LB-05; Dark Magician; UR']) })
    await refreshIntlSets(db, f.client, NOW)
    f.lists = []
    f.pages.clear()
    f.lists = [LB]
    f.pages.set(LB, listPage(['LB-05; Dark Magician; UR']))
    await refreshIntlSets(db, f.client, NOW)
    expect(db.prepare('SELECT language FROM sets ORDER BY language').all()).toEqual([
      { language: 'en' },
      { language: 'ja' }
    ])
  })

  it('a clean run only prunes languages present in the listing', async () => {
    const f = fake({ [LB]: listPage(['LB-05; Dark Magician; UR']) })
    await refreshIntlSets(db, f.client, NOW)
    const card = db.prepare('SELECT id FROM cards ORDER BY id LIMIT 1').get() as { id: number }
    db.prepare(
      "INSERT INTO sets (language, set_name, set_code) VALUES ('ko', 'Korean Set', '')"
    ).run()
    db.prepare(
      `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity, set_rarity_code, missing_from_api)
       VALUES (?, 'ko', 'Korean Set', 'K-1', 'Common', '', 0)`
    ).run(card.id)
    const res = await refreshIntlSets(db, f.client, NOW)
    expect(res.ok).toBe(true)
    expect(db.prepare("SELECT set_name FROM sets WHERE language = 'ko'").all()).toHaveLength(1)
    expect(
      db.prepare("SELECT missing_from_api FROM card_printings WHERE language = 'ko'").all()
    ).toEqual([{ missing_from_api: 0 }])
  })

  it('keeps the stored image when the image lookup fails but the infobox parses', async () => {
    const f = fake({
      [LB]: listPage(['LB-05; Dark Magician; UR']),
      'Legend of Blue Eyes White Dragon': infobox('| image = LB-JP.png\n| jp_release_date = March 8, 2002')
    })
    await refreshIntlSets(db, f.client, NOW)
    const before = db.prepare("SELECT image_url, image_key FROM sets WHERE language = 'ja'").get()
    expect((before as { image_key: string }).image_key).toBeTruthy()
    f.pages.set(
      'Legend of Blue Eyes White Dragon',
      infobox('| image = LB-JP.png\n| jp_release_date = April 1, 2003')
    )
    f.client.fetchImageUrls = async () => {
      throw new YugipediaError('images down')
    }
    await refreshIntlSets(db, f.client, NOW)
    expect(db.prepare("SELECT image_url, image_key FROM sets WHERE language = 'ja'").get()).toEqual(before)
    expect(db.prepare("SELECT tcg_date FROM sets WHERE language = 'ja'").get()).toEqual({
      tcg_date: '2003-04-01'
    })
  })
})

describe('shouldRefreshIntl', () => {
  it('is true when unset, false 6 days after, true 7 days after', () => {
    expect(shouldRefreshIntl(db, NOW)).toBe(true)
    db.prepare("INSERT INTO meta (key, value) VALUES ('intl_sets_synced_at', ?)").run(
      NOW.toISOString()
    )
    expect(shouldRefreshIntl(db, new Date(NOW.getTime() + 6 * 86400000))).toBe(false)
    expect(shouldRefreshIntl(db, new Date(NOW.getTime() + INTL_INTERVAL_MS))).toBe(true)
  })

  it('is true for an unparseable stamp', () => {
    db.prepare("INSERT INTO meta (key, value) VALUES ('intl_sets_synced_at', 'garbage')").run()
    expect(shouldRefreshIntl(db, NOW)).toBe(true)
  })
})
