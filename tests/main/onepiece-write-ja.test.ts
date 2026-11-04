import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { parseCardList, parseSeriesList } from '../../scripts/catalog/onepiece/bandai'
import type { OpMatch } from '../../scripts/catalog/onepiece/match'
import type { BandaiEntry, BandaiSeries } from '../../scripts/catalog/onepiece/types'
import { writeOnePiece, type OpPlan } from '../../scripts/catalog/onepiece/write'
import { openDatabase } from '../../src/main/db/database'
import { onePieceCardId, onePieceImageId } from '../../src/shared/games'

const read = (name: string): string =>
  readFileSync(join(__dirname, '../fixtures/onepiece', name), 'utf8')
const EN_SERIES = parseSeriesList(read('bandai-op17.html')).series
const EN_OP17 = EN_SERIES[0]
const EN = parseCardList(read('bandai-op17.html'), EN_OP17.id).entries
const JA_SERIES = parseSeriesList(read('bandai-ja-op17.html')).series
const JA_OP17 = JA_SERIES.find((s) => s.id === '550117')!
const JA = parseCardList(read('bandai-ja-op17.html'), JA_OP17.id).entries
const ja = (id: string): BandaiEntry => JA.find((e) => e.bandaiId === id)!
const en = (id: string): BandaiEntry => EN.find((e) => e.bandaiId === id)!
const NOW = Date.parse('2026-11-04T06:00:00Z')

let dir: string
let db: Database.Database
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'op-write-ja-'))
  db = openDatabase(join(dir, 'work.sqlite'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function plan(series: BandaiSeries[], entries: BandaiEntry[], extra: Partial<OpPlan> = {}): OpPlan {
  return {
    series,
    entries,
    groupOf: new Map(),
    matches: new Map<string, OpMatch>(),
    prices: new Map(),
    hashed: new Set(entries.map((e) => e.bandaiId)),
    frozen: new Set(),
    firstSeen: new Map(entries.map((e) => [e.bandaiId, NOW])),
    ...extra
  }
}
const writeEn = (entries: BandaiEntry[], now = NOW): ReturnType<typeof writeOnePiece> =>
  writeOnePiece(db, plan(EN_SERIES, entries), { now, nowIso: new Date(now).toISOString() })
const writeJa = (
  entries: BandaiEntry[],
  extra: Partial<OpPlan> = {},
  now = NOW
): ReturnType<typeof writeOnePiece> =>
  writeOnePiece(db, plan(JA_SERIES, entries, extra), {
    now,
    nowIso: new Date(now).toISOString(),
    region: 'ja'
  })

interface Row {
  set_rarity_code: string
  set_rarity: string
  language: string
  card_id: number
  set_name: string
  missing_from_api: number
  pkey: string
}
const rows = (language: string): Row[] =>
  db
    .prepare(
      "SELECT * FROM card_printings WHERE game = 'op' AND language = ? ORDER BY set_rarity_code"
    )
    .all(language) as Row[]

describe('writeOnePiece, Japanese', () => {
  test('writes Japanese ids, keys, sets and labels, with parallels on first sight', () => {
    const r = writeJa([ja('OP17-001'), ja('OP17-001_p1'), ja('EB04-007_p2'), ja('EB04-061_p3')], {
      labels: new Map([['OP17-001_p1', 'Alternate Art']])
    })
    const leader = onePieceCardId('ja', 'OP17-001')
    // EB04-061_p3 is another set's card in OP17: an SP, as in English.
    expect(rows('ja').map((p) => [p.set_rarity_code, p.set_rarity, p.card_id === leader])).toEqual([
      ['EB04-007_p2', 'SP', false],
      ['EB04-061_p3', 'SP', false],
      ['OP17-001', 'L', true],
      ['OP17-001_p1', 'L (Alternate Art)', true]
    ])
    expect(rows('ja')[2].pkey).toBe(`ja|${leader}|世界最強の戦士 [OP-17]|OP17-001|L`)
    expect(rows('en')).toEqual([])
    expect(
      db
        .prepare('SELECT bandai_id FROM onepiece_images WHERE image_id = ?')
        .get(onePieceImageId('ja', 'OP17-001_p1'))
    ).toEqual({ bandai_id: 'ja:OP17-001_p1' })
    expect(
      db.prepare("SELECT language, set_name, set_code FROM sets WHERE game = 'op'").all()
    ).toEqual([{ language: 'ja', set_name: '世界最強の戦士 [OP-17]', set_code: 'OP17' }])
    expect(r).toMatchObject({ cards: 3, printings: 4, priced: 0, held: 0, images: 4 })
    expect(r.perSet).toEqual([{ setCode: 'OP17', printings: 4, priced: 0 }])
  })

  test("a Japanese id that lands on a stored English one is refused before any write", () => {
    writeEn([en('OP17-001')])
    const enImage = onePieceImageId('en', 'OP17-001')
    const before = rows('ja').length
    expect(() =>
      writeOnePiece(db, plan(JA_SERIES, [ja('OP17-001')]), {
        now: NOW,
        nowIso: new Date(NOW).toISOString(),
        region: 'ja',
        idOf: { card: (n) => onePieceCardId('ja', n), image: () => enImage }
      })
    ).toThrow('One Piece id collision')
    expect(rows('ja').length).toBe(before)
    expect(db.prepare('SELECT bandai_id FROM onepiece_images WHERE image_id = ?').get(enImage)).toEqual({ bandai_id: 'OP17-001' })
  })

  test('a parallel with no English twin is written as Parallel at once', () => {
    writeJa([ja('OP17-001'), ja('OP17-001_p1')])
    expect(rows('ja').map((p) => p.set_rarity)).toEqual(['L', 'L (Parallel)'])
  })

  test('a number English has takes its English name and text; one it lacks keeps the Japanese', () => {
    writeEn([en('OP17-001')])
    writeJa([ja('OP17-001'), ja('OP17-061')])
    const card = (id: number): unknown =>
      db
        .prepare(
          `SELECT c.name, c."desc", oc.traits, oc.colors, oc.life FROM cards c JOIN onepiece_cards oc ON oc.card_id = c.id WHERE c.id = ?`
        )
        .get(id)
    const english = card(onePieceCardId('en', 'OP17-001')) as {
      name: string
      desc: string
      traits: string
    }
    expect(card(onePieceCardId('ja', 'OP17-001'))).toEqual({
      ...english,
      colors: '["Red"]',
      life: 5
    })
    expect(card(onePieceCardId('ja', 'OP17-061'))).toMatchObject({
      name: '大看板',
      traits: '["魚人族","百獣海賊団"]'
    })
  })

  test('each language leaves the other alone', () => {
    writeEn([en('OP17-001'), en('OP17-005')])
    const enIds = [en('OP17-001'), en('OP17-005')].map((e) => onePieceImageId('en', e.bandaiId))
    const hash = (): string =>
      createHash('sha256')
        .update(
          JSON.stringify([
            db.prepare("SELECT * FROM card_printings WHERE language = 'en' ORDER BY id").all(),
            db
              .prepare(
                `SELECT * FROM card_images WHERE image_id IN (${enIds.join(',')}) ORDER BY image_id`
              )
              .all(),
            db
              .prepare(
                `SELECT * FROM onepiece_images WHERE image_id IN (${enIds.join(',')}) ORDER BY image_id`
              )
              .all(),
            db.prepare("SELECT * FROM sets WHERE language = 'en' ORDER BY set_name").all(),
            db.prepare(`SELECT * FROM cards WHERE id = ${onePieceCardId('en', 'OP17-001')}`).all()
          ])
        )
        .digest('hex')
    const before = hash()
    writeJa([ja('OP17-001')])
    expect(hash()).toBe(before)
    // English again, with nothing new: nothing changes, and no Japanese row is flagged missing.
    const r = writeEn([en('OP17-001'), en('OP17-005')], NOW + 1000)
    expect(hash()).toBe(before)
    expect(rows('ja').map((p) => p.missing_from_api)).toEqual([0])
    expect(
      db
        .prepare('SELECT missing_from_api AS m FROM card_images WHERE image_id = ?')
        .get(onePieceImageId('ja', 'OP17-001'))
    ).toEqual({ m: 0 })
    expect(r.perSet).toEqual([{ setCode: 'OP17', printings: 2, priced: 0 }])
    // And Japanese again leaves English alone.
    writeJa([ja('OP17-001')], {}, NOW + 2000)
    expect(rows('en').map((p) => p.missing_from_api)).toEqual([0, 0])
    expect(hash()).toBe(before)
  })

  test('a Japanese entry Bandai stops listing is flagged, its English twin is not', () => {
    writeEn([en('OP17-001')])
    writeJa([ja('OP17-001'), ja('OP17-001_p1')])
    writeJa([ja('OP17-001')], {}, NOW + 1000)
    expect(rows('ja').map((p) => [p.set_rarity_code, p.missing_from_api])).toEqual([
      ['OP17-001', 0],
      ['OP17-001_p1', 1]
    ])
    expect(rows('en').map((p) => p.missing_from_api)).toEqual([0])
    expect(
      db
        .prepare('SELECT missing_from_api AS m FROM card_images WHERE image_id = ?')
        .get(onePieceImageId('ja', 'OP17-001_p1'))
    ).toEqual({ m: 1 })
  })

  test('a borrowed label that disagrees with the stored one is a note', () => {
    writeJa([ja('OP17-001'), ja('OP17-001_p1')])
    const r = writeJa(
      [ja('OP17-001'), ja('OP17-001_p1')],
      { labels: new Map([['OP17-001_p1', 'Alternate Art']]) },
      NOW + 1000
    )
    expect(rows('ja').map((p) => p.set_rarity)).toEqual(['L', 'L (Parallel)'])
    expect(r.notes).toContain(
      'OP17-001_p1: its English twin is Alternate Art, keeps "L (Parallel)"'
    )
  })
})
