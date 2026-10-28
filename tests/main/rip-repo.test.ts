import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import {
  openPack,
  ripHistory,
  ripPool,
  ripSession,
  ripSets,
  startRip
} from '../../src/main/repo/rip'
import { RIP_LAYOUTS } from '../../src/shared/rip/layouts'
import { mulberry32 } from '../../src/shared/rip/roll'

const SET = 'Rip Test Set'
const OTHER = 'Rip Thin Set'
// core-2020: 8 Commons + 1 foil (Super Rare, with Ultra/Secret/Starlight chances)
const LAYOUTS = { TST: 'core-2020', THN: 'core-2020' }
const PACK_SIZE = RIP_LAYOUTS['core-2020'].slots.reduce((n, s) => n + s.count, 0)
const now = new Date('2026-10-27T10:00:00.000Z')

let db: Database.Database
let next = 1000

function addCard(name: string): number {
  const id = next++
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES (?, ?, 'Normal Monster', 'normal', 'Warrior', '', '2026-10-01')`
  ).run(id, name)
  db.prepare(
    'INSERT INTO card_images (image_id, card_id, sort_order) VALUES (?, ?, 0), (?, ?, 1)'
  ).run(id * 10, id, id * 10 + 1, id)
  return id
}

function addPrinting(
  cardId: number,
  setName: string,
  code: string,
  rarity: string,
  extra: { language?: string; contributed?: number } = {}
): void {
  db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, contributed)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(cardId, setName, code, rarity, extra.language ?? 'en', extra.contributed ?? 0)
}

beforeEach(async () => {
  db = await seededDb()
  db.prepare(
    "INSERT INTO sets (language, set_name, set_code, tcg_date) VALUES ('en', ?, 'TST', '2020-01-01')"
  ).run(SET)
  for (let i = 0; i < 10; i++)
    addPrinting(addCard(`Common ${i}`), SET, `TST-EN${100 + i}`, 'Common')
  for (let i = 0; i < 3; i++)
    addPrinting(addCard(`Super ${i}`), SET, `TST-EN${200 + i}`, 'Super Rare')
  addPrinting(addCard('Ultra One'), SET, 'TST-EN300', 'Ultra Rare')
  addPrinting(addCard('Secret One'), SET, 'TST-EN301', 'Secret Rare')
  // noise that must stay out of the pool
  addPrinting(addCard('Fr Card'), SET, 'TST-FR100', 'Common', { language: 'fr' })
  addPrinting(addCard('Mine'), SET, 'TST-EN999', 'Common', { contributed: 1 })
  // a set with a layout but only Commons: cannot fill the foil slot
  for (let i = 0; i < 3; i++) addPrinting(addCard(`Thin ${i}`), OTHER, `THN-EN00${i}`, 'Common')
})
afterEach(() => db.close())

describe('rip repo', () => {
  it('pool is English, visible printings of the set', () => {
    const pool = ripPool(db, SET)
    expect(pool).toHaveLength(15)
    expect(pool.every((c) => c.setCode.startsWith('TST-EN') && c.setCode !== 'TST-EN999')).toBe(
      true
    )
    const ultra = pool.find((c) => c.name === 'Ultra One')!
    expect(ultra).toMatchObject({ rarity: 'Ultra Rare', frameType: 'normal', variant: null })
    expect(ultra.imageId).toBe(ultra.cardId * 10) // lowest sort_order
    expect(ultra.pkey).toBe(`en|${ultra.cardId}|TST-EN300|Ultra Rare`)
  })

  it("pool fixes a rarity's capitalisation, so a typo still rolls and ranks", () => {
    addPrinting(addCard('Typo Card'), 'Typo Set', 'TYP-EN001', 'PLatinum Secret Rare')
    expect(ripPool(db, 'Typo Set')[0].rarity).toBe('Platinum Secret Rare')
  })

  it('rejects bad pack counts', () => {
    for (const n of [0, 101, 2.5, NaN]) expect(() => startRip(db, SET, n, now, LAYOUTS)).toThrow()
  })

  it('rejects sets that cannot be ripped', () => {
    expect(() => startRip(db, OTHER, 1, now, LAYOUTS)).toThrow()
    expect(() => startRip(db, 'Nope', 1, now, LAYOUTS)).toThrow()
    expect(() => startRip(db, SET, 1, now, {})).toThrow() // no layout for the set
    expect(() => startRip(db, 'Fr Only', 1, now, LAYOUTS)).toThrow()
  })

  it('opens and saves packs up to the count', () => {
    const id = startRip(db, SET, 2, now, LAYOUTS)
    const rand = mulberry32(7)
    const a = openPack(db, id, rand, LAYOUTS)
    openPack(db, id, rand, LAYOUTS)
    expect(a).toHaveLength(PACK_SIZE)
    expect(() => openPack(db, id, rand, LAYOUTS)).toThrow()
    const s = ripSession(db, id)!
    expect(s.packs).toHaveLength(2)
    expect(s.packs.every((p) => p.length === PACK_SIZE)).toBe(true)
    expect(s.packs[0]).toEqual(a)
    expect(s.packsOpened).toBe(2)
    expect(ripSession(db, 9999)).toBeNull()
  })

  it('session counts only opened packs', () => {
    const id = startRip(db, SET, 5, now, LAYOUTS)
    const rand = mulberry32(1)
    openPack(db, id, rand, LAYOUTS)
    openPack(db, id, rand, LAYOUTS)
    const h = ripHistory(db)
    expect(h.sessions[0]).toMatchObject({
      id,
      packCount: 5,
      packsOpened: 2,
      setName: SET,
      setCode: 'TST'
    })
    expect(h.packsOpened).toBe(2)
    expect(h.cardsPulled).toBe(2 * PACK_SIZE)
    expect(h.setsRipped).toBe(1)
  })

  it('a failed pack saves nothing', () => {
    const id = startRip(db, SET, 2, now, LAYOUTS)
    expect(() =>
      openPack(
        db,
        id,
        () => {
          throw new Error('boom')
        },
        LAYOUTS
      )
    ).toThrow('boom')
    expect(ripSession(db, id)!.packsOpened).toBe(0)
  })

  it('pull survives printing deletion', () => {
    const id = startRip(db, SET, 1, now, LAYOUTS)
    const [first] = openPack(db, id, mulberry32(3), LAYOUTS)
    db.prepare('DELETE FROM card_printings WHERE pkey = ?').run(first.pkey)
    const got = ripSession(db, id)!.packs[0][0]
    expect(got.name).toBe(first.name)
    expect(got.rarity).toBe(first.rarity)
  })

  it('best pulls ranked by rarity then newest, skipping plain cards', () => {
    const id = startRip(db, SET, 1, now, LAYOUTS)
    const ins = db.prepare(
      `INSERT INTO rip_pulls (session_id, pack, slot, pkey, card_id, name, set_code, rarity, variant, frame_type, image_id)
       VALUES (?, ?, ?, ?, 1, ?, 'TST-EN1', ?, NULL, 'normal', NULL)`
    )
    ins.run(id, 0, 0, 'a', 'Old Super', 'Super Rare')
    ins.run(id, 0, 1, 'b', 'Plain', 'Common')
    ins.run(id, 0, 2, 'c', 'Secret', 'Secret Rare')
    const id2 = startRip(db, SET, 1, now, LAYOUTS)
    ins.run(id2, 0, 0, 'd', 'New Super', 'Super Rare')
    const best = ripHistory(db).bestPulls.map((c) => c.name)
    expect(best).toEqual(['Secret', 'New Super', 'Old Super'])
    expect(ripHistory(db, { bestLimit: 1 }).bestPulls).toHaveLength(1)
    expect(ripSession(db, id)!.best?.name).toBe('Secret')
    expect(ripHistory(db).sessions.map((s) => s.id)).toEqual([id2, id])
    expect(ripHistory(db, { sessionLimit: 1, sessionOffset: 1 }).sessions.map((s) => s.id)).toEqual(
      [id]
    )
  })

  it('does not touch the collection', () => {
    const count = (t: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
    const tables = ['collection_entries', 'value_snapshots', 'sync_pending']
    const before = tables.map(count)
    const id = startRip(db, SET, 1, now, LAYOUTS)
    openPack(db, id, mulberry32(5), LAYOUTS)
    expect(tables.map(count)).toEqual(before)
  })

  it('ripSets lists only rippable English sets', () => {
    const sets = ripSets(db, LAYOUTS)
    expect(sets.map((s) => s.setName)).toEqual([SET])
    expect(sets[0]).toMatchObject({
      setCode: 'TST',
      tcgDate: '2020-01-01',
      layoutLabel: RIP_LAYOUTS['core-2020'].label,
      packLine: '9 cards a pack · 1 Super or better'
    })
    expect(ripSets(db, {})).toEqual([])
  })

  it('does not offer or start non-core products that share a core set code', () => {
    const NAME = 'Rip Test Set (25th Anniversary Edition)'
    db.prepare(
      "INSERT INTO sets (language, set_name, set_code, tcg_date) VALUES ('en', ?, 'TST', '2021-01-01')"
    ).run(NAME)
    for (let i = 0; i < 10; i++)
      addPrinting(addCard(`Anniv ${i}`), NAME, `TST-EN${500 + i}`, 'Common')
    addPrinting(addCard('Anniv Super'), NAME, 'TST-EN600', 'Super Rare')
    expect(ripSets(db, LAYOUTS).map((s) => s.setName)).toEqual([SET])
    expect(() => startRip(db, NAME, 1, now, LAYOUTS)).toThrow(/can't be ripped/)
  })

  it('offers a 25th Anniversary Rarity Collection, and its Supers and Ultras are no best pulls', () => {
    const NAME = '25th Anniversary Rarity Collection'
    db.prepare(
      "INSERT INTO sets (language, set_name, set_code, tcg_date) VALUES ('en', ?, 'RA01', '2023-11-03')"
    ).run(NAME)
    for (let n = 1; n <= 6; n++) {
      const id = addCard(`RA Card ${n}`)
      for (const r of ['Super Rare', 'Ultra Rare', 'Secret Rare', 'Platinum Secret Rare'])
        addPrinting(id, NAME, `RA01-EN00${n}`, r)
    }
    const offered = ripSets(db).find((s) => s.setName === NAME)!
    expect(offered.packLine).toBe(
      '5 cards a pack · 2 Super + 1 Secret or better + 2 Ultra or better'
    )
    const id = startRip(db, NAME, 1, now)
    expect(openPack(db, id, mulberry32(4))).toHaveLength(5)
    // Supers and Ultras are the floor here; a Secret is a hit.
    const best = ripHistory(db).bestPulls
    expect(best.map((c) => c.rarity)).not.toContain('Super Rare')
    expect(best.map((c) => c.rarity)).not.toContain('Ultra Rare')
    expect(best.length).toBeGreaterThan(0)
  })

  it('history lists only sessions with pulls', () => {
    const empty = startRip(db, SET, 2, now, LAYOUTS)
    const used = startRip(db, SET, 1, now, LAYOUTS)
    openPack(db, used, mulberry32(3), LAYOUTS)
    const h = ripHistory(db)
    expect(h.sessions.map((s) => s.id)).toEqual([used])
    expect(h.sessions.map((s) => s.id)).not.toContain(empty)
    expect(h.packsOpened).toBe(1)
    expect(h.setsRipped).toBe(1)
  })
})
