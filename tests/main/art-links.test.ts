import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { borrowedArt, japaneseArt, traditionalArt } from '../../src/main/repo/cards'

let db: Database.Database
afterEach(() => db?.close())

function card(id: number, game: string, imageId = id): void {
  db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, ?, ?, 'x', 'normal', 'x', '', '2026-01-01')`
  ).run(id, game, `Card ${id}`)
  db.prepare(
    'INSERT INTO card_images (image_id, card_id, game, sort_order) VALUES (?, ?, ?, 0), (?, ?, ?, 1)'
  ).run(imageId, id, game, imageId + 500_000, id, game)
}

function pokemon(
  id: number,
  source: string,
  links: { art?: number; traditional?: number; ownArt?: boolean } = {}
): void {
  card(id, 'pkm', id + 1_000_000)
  db.prepare(
    `INSERT INTO pokemon_cards (card_id, category, source_id, art_twin_id, traditional_twin_id, image_url)
     VALUES (?, 'Pokemon', ?, ?, ?, ?)`
  ).run(
    id,
    source,
    links.art ?? null,
    links.traditional ?? null,
    links.ownArt ? 'https://x/a' : null
  )
}

/** The query as it was before the join order was pinned (plain JOINs). */
function before(column: string, language?: string): [number, number][] {
  return (
    db
      .prepare(
        `SELECT i.image_id AS own, t.image_id AS twin FROM pokemon_cards p
         JOIN card_images i ON i.card_id = p.card_id AND i.sort_order = 0
         JOIN card_images t ON t.card_id = p.${column} AND t.sort_order = 0
         ${language ? `JOIN pokemon_cards l ON l.card_id = p.${column} AND l.source_id LIKE ?` : ''}
         WHERE p.${column} IS NOT NULL AND p.image_url IS NULL`
      )
      .all(...(language ? [`${language}/%`] : [])) as { own: number; twin: number }[]
  ).map((r) => [r.own, r.twin])
}

const sorted = (rows: [number, number][]): [number, number][] =>
  [...rows].sort((a, b) => a[0] - b[0] || a[1] - b[1])

describe('art links', () => {
  beforeEach(() => {
    db = openDatabase(':memory:')
    // Other games' art, which the join must not wander into.
    for (let i = 1; i <= 300; i++) card(i, i % 3 === 0 ? 'ygo' : 'mtg')
    for (let i = 0; i < 40; i++) pokemon(10_000 + i, `en/sv03-${i}`)
    for (let i = 0; i < 20; i++) pokemon(11_000 + i, `ja/sv3-${i}`)
    for (let i = 0; i < 10; i++) pokemon(12_000 + i, `zh-hant/SV3-${i}`)
    for (let i = 0; i < 40; i++) {
      pokemon(20_000 + i, `zh-hans/CSV3-${i}`, {
        // English twins, then Japanese twins; every fifth also Traditional; every seventh has its own art.
        art: i < 25 ? 10_000 + i : 11_000 + (i - 25),
        traditional: i % 5 === 0 ? 12_000 + (i % 10) : undefined,
        ownArt: i % 7 === 0
      })
    }
  })

  it('returns the same rows as the plain-JOIN query', () => {
    expect(sorted(borrowedArt(db))).toEqual(sorted(before('art_twin_id')))
    expect(sorted(japaneseArt(db))).toEqual(sorted(before('art_twin_id', 'ja')))
    expect(sorted(traditionalArt(db))).toEqual(sorted(before('traditional_twin_id')))
  })

  it('links own image to twin image, leaving out cards with art of their own', () => {
    const english = borrowedArt(db)
    // 40 linked, 6 with art of their own (0, 7, 14, 21, 28, 35).
    expect(english).toHaveLength(34)
    expect(english).toContainEqual([1_020_001, 1_010_001])
    expect(english.some(([own]) => own === 1_020_007)).toBe(false)
    expect(sorted(japaneseArt(db))).toEqual(
      sorted(english.filter(([, twin]) => twin >= 1_011_000 && twin < 1_012_000))
    )
    expect(japaneseArt(db)).toHaveLength(13)
    expect(traditionalArt(db)).toContainEqual([1_020_005, 1_012_005])
  })
})
