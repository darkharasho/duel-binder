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
import { mtgCardId, mtgImageId } from '../../src/shared/games/ids'
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
      card: (s: string) => (s === b.oracle_id ? shared : mtgCardId('en', s)),
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
})
