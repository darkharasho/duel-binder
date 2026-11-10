import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mtgRows } from '../../scripts/catalog/magic/rows'
import { isKept, parseBulkLines } from '../../scripts/catalog/magic/scryfall'
import type { ScryCard, ScrySet } from '../../scripts/catalog/magic/types'
import { writeMagic, type MagicReport } from '../../scripts/catalog/magic/write'
import { openDatabase } from '../../src/main/db/database'
import { runSync } from '../../src/main/sync/sync'
import type { YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import { mtgBackImageId, mtgCardId, mtgImageId } from '../../src/shared/games/ids'
import { finishOf } from '../../src/shared/games/magic'
import fixture from '../fixtures/cardinfo.sample.json'
import { seedOnePiece } from '../fixtures/onePiece'
import { seedPokemon } from '../fixtures/pokemon'
import { catalogHashes } from '../helpers/catalogHashes'

async function* lines(text: string): AsyncIterable<string> {
  for (const l of text.split('\n')) yield l
}
const OBJECTS: ScryCard[] = []
let SETS: ScrySet[] = []
const NOW = Date.parse('2026-11-09T06:00:00Z')

let dir: string
let db: Database.Database

beforeEach(async () => {
  if (OBJECTS.length === 0) {
    for await (const c of parseBulkLines(
      lines(readFileSync('tests/fixtures/scryfall/default-cards.sample.json', 'utf8'))
    ))
      if (isKept(c)) OBJECTS.push(c)
    SETS = (
      JSON.parse(readFileSync('tests/fixtures/scryfall/sets.sample.json', 'utf8')) as {
        data: ScrySet[]
      }
    ).data
  }
  dir = mkdtempSync(join(tmpdir(), 'mtg-write-'))
  db = openDatabase(join(dir, 'work.sqlite'))
  const client: YgoClient = {
    fetchDbVersion: async () => ({ databaseVersion: '1', lastUpdate: '2026-10-22' }),
    fetchCardInfo: async () => fixture.data as ApiCard[],
    fetchCardSets: async () => []
  }
  await runSync(db, client, () => {}, new Date('2026-10-23T12:00:00.000Z'))
  seedPokemon(db)
  seedOnePiece(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const clone = (o: ScryCard, patch: Partial<ScryCard> = {}): ScryCard => ({
  ...structuredClone(o),
  ...patch
})
const write = (
  objects: ScryCard[],
  sets = SETS,
  idOf?: Parameters<typeof writeMagic>[2]['idOf']
): MagicReport =>
  writeMagic(db, mtgRows(objects, sets), {
    now: NOW,
    nowIso: new Date(NOW).toISOString(),
    updatedAt: '2026-11-09',
    idOf
  })

interface Printing {
  id: number
  card_id: number
  set_name: string
  set_code: string
  set_rarity: string
  set_rarity_code: string
  market_price: number | null
  missing_from_api: number
  pkey: string
}
const printings = (): Printing[] =>
  db
    .prepare("SELECT * FROM card_printings WHERE game = 'mtg' ORDER BY set_rarity_code, set_rarity")
    .all() as Printing[]
const MTG_TABLES = ['cards', 'card_images', 'card_printings', 'sets', 'mtg_cards', 'mtg_images']
const counts = (): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const t of MTG_TABLES) {
    const where = t.startsWith('mtg_') ? '' : " WHERE game = 'mtg'"
    out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}${where}`).get() as { n: number }).n
  }
  return out
}
const mtgHash = (): string =>
  JSON.stringify(
    MTG_TABLES.map((t) => {
      const where = t.startsWith('mtg_') ? '' : " WHERE game = 'mtg'"
      return db.prepare(`SELECT * FROM ${t}${where} ORDER BY rowid`).all()
    })
  )
const plain = (): ScryCard =>
  OBJECTS.find(
    (o) =>
      o.finishes.length === 2 && o.finishes.includes('foil') && o.prices?.usd && o.prices?.usd_foil
  )!
const priced = (o: ScryCard, usd: string | null, foil: string | null): ScryCard =>
  clone(o, { prices: { ...o.prices, usd, usd_foil: foil } })

/** Ten distinct Scryfall objects (the fixture's, recycled under new ids and numbers). */
const tenObjects = (): ScryCard[] =>
  Array.from({ length: 10 }, (_, i) =>
    clone(OBJECTS[i % OBJECTS.length], {
      id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
      collector_number: String(900 + i)
    })
  )

describe('writeMagic', () => {
  it('writes the fixture', () => {
    const rows = mtgRows(OBJECTS, SETS)
    const r = write(OBJECTS)
    const c = counts()
    expect(c.cards).toBe(rows.cards.size)
    expect(c.mtg_cards).toBe(rows.cards.size)
    expect(c.card_images).toBe(rows.images.length)
    expect(c.mtg_images).toBe(rows.images.length)
    expect(c.card_printings).toBe(rows.printings.length)
    expect(c.sets).toBe(rows.sets.size)
    expect(r.printings).toBe(rows.printings.length)
    const p = plain()
    const mine = printings().filter((x) => x.set_rarity_code === p.id)
    const code = `${p.set.toUpperCase()} ${p.collector_number}`
    expect(mine.map((x) => [x.set_code, x.set_rarity, x.market_price])).toEqual([
      [code, expect.stringMatching(/^[A-Z][a-z]+$/), Number(p.prices?.usd)],
      [code, expect.stringMatching(/^[A-Z][a-z]+ \(Foil\)$/), Number(p.prices?.usd_foil)]
    ])
    const cardId = mtgCardId('en', p.oracle_id as string)
    expect(mine[1].pkey).toBe(`en|${cardId}|${code}|${mine[1].set_rarity}`)
    expect(
      db.prepare("SELECT frame_type FROM cards WHERE game = 'mtg' AND id = ?").get(cardId)
    ).toEqual({ frame_type: 'mtg' })
    expect(db.prepare('SELECT image_id FROM mtg_images WHERE scryfall_id = ?').get(p.id)).toEqual({
      image_id: mtgImageId(p.id)
    })
    expect(finishOf(mine[1].set_rarity)).toBe('foil')
  })

  it('prices move enough, keep on null', () => {
    const p = plain()
    const price = (): (number | null)[] =>
      printings()
        .filter((x) => x.set_rarity_code === p.id)
        .map((x) => x.market_price)
    write([priced(p, '100.00', '200.00')])
    write([priced(p, '101.00', '202.00')])
    expect(price()).toEqual([100, 200])
    write([priced(p, '130.00', '260.00')])
    expect(price()).toEqual([130, 260])
    write([priced(p, null, null)])
    expect(price()).toEqual([130, 260])
  })

  it('labels never move', () => {
    const p = plain()
    write([p])
    const before = printings().map((x) => x.set_rarity)
    const changed = p.rarity === 'mythic' ? 'common' : 'mythic'
    write([clone(p, { rarity: changed })])
    expect(printings().map((x) => x.set_rarity)).toEqual(before)
    expect(before.join()).not.toMatch(new RegExp(changed, 'i'))
  })

  it('missing is flagged, not deleted', () => {
    const night1 = tenObjects()
    write(night1)
    const before = counts()
    const gone = night1[9]
    write(night1.slice(0, 9))
    expect(counts()).toEqual(before)
    const flagged = printings().filter((x) => x.missing_from_api === 1)
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged.every((x) => x.set_rarity_code === gone.id)).toBe(true)
    expect(
      db
        .prepare('SELECT missing_from_api FROM card_images WHERE image_id = ?')
        .get(mtgImageId(gone.id))
    ).toEqual({ missing_from_api: 1 })
    const r = write(night1)
    expect(printings().every((x) => x.missing_from_api === 0)).toBe(true)
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM card_images WHERE game = 'mtg' AND missing_from_api = 1"
        )
        .get()
    ).toEqual({ n: 0 })
    expect(r.missing).toBe(0)
  })

  it('short file writes nothing', () => {
    const ten = tenObjects()
    write(ten)
    const before = mtgHash()
    expect(() => write(ten.slice(0, 8))).toThrow('Scryfall file too short: 8 objects, 10 stored')
    expect(mtgHash()).toBe(before)
  })

  it('id collision throws and writes nothing', () => {
    const a = OBJECTS[0]
    const b = OBJECTS.find((o) => o.oracle_id !== a.oracle_id)!
    const shared = mtgCardId('en', a.oracle_id as string)
    const idOf = {
      card: (lang: string, s: string) => (s === b.oracle_id ? shared : mtgCardId(lang, s)),
      image: mtgImageId
    }
    const before = mtgHash()
    expect(() => write([a, b], SETS, idOf)).toThrow(/^Magic id collision: .* and .* → \d+$/)
    expect(mtgHash()).toBe(before)
  })

  it('taken set name gets its code', () => {
    const [a, b] = OBJECTS
    const sets: ScrySet[] = [
      {
        ...SETS[0],
        code: 'pa',
        name: 'Promos',
        parent_set_code: undefined,
        released_at: '2020-01-01'
      },
      {
        ...SETS[0],
        code: 'pb',
        name: 'Promos',
        parent_set_code: undefined,
        released_at: '2020-01-02'
      }
    ]
    write(
      [clone(a, { set: 'pa', set_name: 'Promos' }), clone(b, { set: 'pb', set_name: 'Promos' })],
      sets
    )
    expect(
      db.prepare("SELECT set_code, set_name FROM sets WHERE game = 'mtg' ORDER BY set_code").all()
    ).toEqual([
      { set_code: 'PA', set_name: 'Promos' },
      { set_code: 'PB', set_name: 'Promos (PB)' }
    ])
    expect(new Set(printings().map((x) => x.set_name))).toEqual(new Set(['Promos', 'Promos (PB)']))
  })

  describe('default art', () => {
    const twoSets = (): ScrySet[] => [
      {
        ...SETS[0],
        code: 'old',
        name: 'Old Set',
        parent_set_code: undefined,
        released_at: '1999-01-01'
      },
      {
        ...SETS[0],
        code: 'new',
        name: 'New Set',
        parent_set_code: undefined,
        released_at: '2020-01-01'
      }
    ]
    const art = (o: ScryCard): { sort_order: number } =>
      db.prepare('SELECT sort_order FROM card_images WHERE image_id = ?').get(mtgImageId(o.id)) as {
        sort_order: number
      }
    const pair = (): { older: ScryCard; newer: ScryCard } => ({
      older: clone(plain(), {
        id: '00000000-0000-4000-8000-0000000000a1',
        set: 'old',
        collector_number: '5'
      }),
      newer: clone(plain(), {
        id: '00000000-0000-4000-8000-0000000000a2',
        set: 'new',
        collector_number: '1'
      })
    })

    it('the oldest printing is the default image whatever the input order', () => {
      const { older, newer } = pair()
      write([newer, older], twoSets())
      expect(art(older).sort_order).toBe(0)
      expect(art(newer).sort_order).toBe(1)
      const total = (): number =>
        (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
      const start = total()
      write([older, newer], twoSets())
      expect(total() - start).toBe(0)
      expect(
        db
          .prepare(
            "SELECT image_id FROM card_images WHERE game = 'mtg' AND card_id = ? AND sort_order = 0"
          )
          .all(mtgCardId('en', older.oracle_id as string))
      ).toEqual([{ image_id: mtgImageId(older.id) }])
    })

    it('the same set breaks ties by collector number', () => {
      const { older } = pair()
      const b = clone(older, { id: '00000000-0000-4000-8000-0000000000a3', collector_number: '12' })
      const a = clone(older, { id: '00000000-0000-4000-8000-0000000000a4', collector_number: '9' })
      write([b, a], twoSets())
      expect(art(a).sort_order).toBe(0)
      expect(art(b).sort_order).toBe(1)
    })
  })

  it('a replaced Scryfall id takes over its missing printing', () => {
    const p = plain()
    write([p])
    const first = printings().find((x) => x.set_rarity_code === p.id)!
    db.prepare(
      `INSERT INTO collection_entries (uid, printing_id, image_id, quantity, created_at, updated_at, game)
       VALUES ('u1', ?, ?, 2, 'x', 'x', 'mtg')`
    ).run(first.id, mtgImageId(p.id))
    const before = printings()
    const replaced = clone(p, { id: '00000000-0000-4000-8000-0000000000b1' })
    const r = write([replaced])
    expect(r.notes.join()).not.toMatch(/key taken/)
    const after = printings()
    expect(after).toHaveLength(before.length)
    expect(after.map((x) => x.id).sort()).toEqual(before.map((x) => x.id).sort())
    expect(after.every((x) => x.set_rarity_code === replaced.id && x.missing_from_api === 0)).toBe(
      true
    )
    expect(
      db.prepare('SELECT printing_id, quantity FROM collection_entries WHERE uid = ?').get('u1')
    ).toEqual({ printing_id: first.id, quantity: 2 })
  })

  it('an image that moves to another oracle id leaves a note', () => {
    const p = plain()
    write([p])
    const other = OBJECTS.find((o) => o.oracle_id !== p.oracle_id && o.oracle_id)!
    const r = write([clone(p, { oracle_id: other.oracle_id })])
    expect(r.notes).toContain(
      `Magic image moved card: ${p.id} ${p.oracle_id} -> ${other.oracle_id}`
    )
  })

  it('leaves every ygo, pkm and op row byte-identical', () => {
    const before = catalogHashes(db, 'mtg')
    expect(Object.keys(before)).toContain('pokemon_cards')
    expect(Object.keys(before)).toContain('onepiece_cards')
    const ten = tenObjects()
    write(ten)
    write(ten.slice(0, 9))
    expect(catalogHashes(db, 'mtg')).toEqual(before)
  })

  it('a second identical night changes nothing', () => {
    write(OBJECTS)
    const total = (): number => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    const start = total()
    write(OBJECTS)
    expect(total() - start).toBe(0)
  })

  describe('languages', () => {
    const EN_ID = '37f79ba7-7b65-4387-b498-f770816ce8dd'
    const JA_ID = '7dd45e88-c36c-468c-b8dc-3459871a075c'
    const DELVER_ID = '11bf83bb-c95b-4b4f-9a56-ce7a1816307a'
    const en = (): ScryCard => clone(OBJECTS.find((o) => o.id === EN_ID)!)
    const ja = (patch: Partial<ScryCard> = {}): ScryCard =>
      clone(
        OBJECTS.find((o) => o.id === JA_ID)!,
        {
          printed_name: 'エルドラージの再利用者',
          prices: { usd: '0.50', usd_foil: null, usd_etched: null },
          ...patch
        }
      )
    const delver = (): ScryCard => clone(OBJECTS.find((o) => o.id === DELVER_ID)!)
    const total = (): number => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    const byLang = (lang: string): Printing[] =>
      db
        .prepare(
          "SELECT * FROM card_printings WHERE game = 'mtg' AND language = ? ORDER BY set_rarity"
        )
        .all(lang) as Printing[]

    it('writes an English and a Japanese object of one oracle card as two cards', () => {
      const oracle = en().oracle_id as string
      const r = write([en(), ja()])
      const enId = mtgCardId('en', oracle)
      const jaId = mtgCardId('ja', oracle)
      expect(db.prepare("SELECT id, name FROM cards WHERE game = 'mtg' ORDER BY id").all()).toEqual(
        [enId, jaId].sort((a, b) => a - b).map((id) => ({ id, name: 'Eldrazi Repurposer' }))
      )
      expect(
        db.prepare('SELECT card_id, lang, local_name, oracle_id FROM mtg_cards ORDER BY lang').all()
      ).toEqual([
        { card_id: enId, lang: 'en', local_name: null, oracle_id: oracle },
        { card_id: jaId, lang: 'ja', local_name: 'エルドラージの再利用者', oracle_id: oracle }
      ])
      expect(
        db
          .prepare(
            "SELECT game, language, set_name, set_code FROM sets WHERE game = 'mtg' ORDER BY language"
          )
          .all()
      ).toEqual([
        { game: 'mtg', language: 'en', set_name: 'Modern Horizons 3', set_code: 'MH3' },
        { game: 'mtg', language: 'ja', set_name: 'Modern Horizons 3', set_code: 'MH3' }
      ])
      const jaRows = byLang('ja')
      expect(jaRows.map((x) => [x.card_id, x.set_name, x.set_code, x.set_rarity_code])).toEqual([
        [jaId, 'Modern Horizons 3', 'MH3 150', JA_ID],
        [jaId, 'Modern Horizons 3', 'MH3 150', JA_ID]
      ])
      expect(jaRows.map((x) => x.set_rarity)).toEqual(['Common', 'Common (Foil)'])
      expect(jaRows[0].pkey).toBe(`ja|${jaId}|Modern Horizons 3|MH3 150|Common`)
      expect(
        db.prepare('SELECT card_id FROM card_images WHERE image_id = ?').get(mtgImageId(JA_ID))
      ).toEqual({ card_id: jaId })
      expect(r.byLanguage).toEqual({
        en: { cards: 1, printings: 2, priced: 2 },
        ja: { cards: 1, printings: 2, priced: 1 }
      })
    })

    it('a Japanese printing of the same set, number and finish never takes the English row', () => {
      write([en()])
      const before = byLang('en')
      expect(before).toHaveLength(2)
      const r = write([en(), ja()])
      expect(r.notes.join()).not.toMatch(/key taken/)
      expect(byLang('en')).toEqual(before)
      const jaRows = byLang('ja')
      expect(jaRows).toHaveLength(2)
      expect(jaRows.every((x) => !before.some((b) => b.id === x.id))).toBe(true)
      expect(jaRows.every((x) => x.set_rarity_code === JA_ID)).toBe(true)
    })

    it('a Japanese printing never takes over a missing English row', () => {
      write([en()])
      const before = byLang('en')
      const r = write([ja()])
      expect(r.notes.join()).not.toMatch(/key taken/)
      expect(byLang('en')).toEqual(before.map((x) => ({ ...x, missing_from_api: 1 })))
      expect(byLang('ja').map((x) => [x.set_rarity_code, x.missing_from_api])).toEqual([
        [JA_ID, 0],
        [JA_ID, 0]
      ])
      expect(r.missing).toBe(2)
    })

    it('a second identical night with every language changes nothing', () => {
      const night = (): ScryCard[] => [
        en(),
        ja(),
        delver(),
        ja({
          id: '00000000-0000-4000-8000-0000000000c1',
          collector_number: '151',
          image_status: 'placeholder'
        })
      ]
      write(night())
      const before = mtgHash()
      const start = total()
      write(night())
      expect(total() - start).toBe(0)
      expect(mtgHash()).toBe(before)
    })

    it('writes back_image_id and art_from, and clears art_from once the art arrives', () => {
      const lent = clone(en(), {
        id: '00000000-0000-4000-8000-0000000000c0',
        collector_number: '151'
      })
      const borrower = (status: string): ScryCard =>
        ja({
          id: '00000000-0000-4000-8000-0000000000c1',
          collector_number: '151',
          image_status: status
        })
      write([lent, borrower('placeholder'), delver()])
      const img = (id: string): unknown =>
        db.prepare('SELECT back_image_id, art_from FROM mtg_images WHERE scryfall_id = ?').get(id)
      expect(img(DELVER_ID)).toEqual({ back_image_id: mtgBackImageId(DELVER_ID), art_from: null })
      expect(img(borrower('x').id)).toEqual({ back_image_id: null, art_from: lent.id })
      write([lent, borrower('highres_scan'), delver()])
      expect(img(borrower('x').id)).toEqual({ back_image_id: null, art_from: null })
    })

    it('a back image id colliding with another image id throws and writes nothing', () => {
      const d = delver()
      const a = en()
      const idOf = {
        card: mtgCardId,
        image: (s: string) => (s === a.id ? mtgBackImageId(d.id) : mtgImageId(s))
      }
      const before = mtgHash()
      expect(() => write([a, d], SETS, idOf)).toThrow(
        `Magic id collision: ${d.id}#back and ${a.id} → ${mtgBackImageId(d.id)}`
      )
      expect(mtgHash()).toBe(before)
    })

    it('byLanguage counts every language, perSet English only', () => {
      const r = write([delver(), ja()])
      expect(r.byLanguage.ja.printings).toBe(2)
      expect(r.byLanguage.en.printings).toBe(2)
      expect(r.perSet.map((s) => s.setCode)).toEqual(['ISD'])
    })
  })
})
