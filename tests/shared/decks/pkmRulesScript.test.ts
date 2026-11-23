import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readEnglishCards, toMtgPackCard } from '../../../scripts/catalog/rules'

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('readEnglishCards', () => {
  it('maps the English rows and skips the others', () => {
    dir = mkdtempSync(join(tmpdir(), 'pkm-rules-'))
    const path = join(dir, 'src.sqlite')
    const db = new Database(path)
    db.exec(`CREATE TABLE td_cards (
      lang TEXT NOT NULL, id TEXT NOT NULL, fetched_at INTEGER NOT NULL, json TEXT NOT NULL,
      PRIMARY KEY (lang, id))`)
    const ins = db.prepare('INSERT INTO td_cards VALUES (?, ?, 0, ?)')
    ins.run(
      'en',
      'a-1',
      JSON.stringify({
        id: 'a-1',
        name: 'Pikachu',
        category: 'Pokemon',
        stage: 'Basic',
        rarity: 'Common',
        legal: { standard: true, expanded: true },
        attacks: [{ name: 'Gnaw', damage: 10 }],
        abilities: [{ name: 'Static', type: 'Ability' }],
        image: 'x'
      })
    )
    ins.run(
      'en',
      'a-2',
      JSON.stringify({
        id: 'a-2',
        name: 'Boss',
        category: 'Trainer',
        legal: { standard: false, expanded: true }
      })
    )
    ins.run('ja', 'a-1', JSON.stringify({ id: 'a-1', name: 'ピカチュウ' }))
    db.close()

    const cards = readEnglishCards(path)
    expect(cards).toHaveLength(2)
    const pika = cards.find((c) => c.id === 'a-1')!
    expect(pika.legal).toEqual({ standard: true, expanded: true })
    expect(pika.attacks).toEqual([{ name: 'Gnaw' }])
    expect(pika.abilities).toEqual([{ name: 'Static' }])
    expect(pika.stage).toBe('Basic')
    expect(cards.find((c) => c.id === 'a-2')!.legal?.standard).toBe(false)
  })

  it('drops unnamed attacks and abilities, and cards with no name', () => {
    // TCGdex leaves some Diamond & Pearl attacks and Poké-Bodies unnamed (dp6-136, dp2-116).
    dir = mkdtempSync(join(tmpdir(), 'pkm-rules-'))
    const path = join(dir, 'src.sqlite')
    const db = new Database(path)
    db.exec(`CREATE TABLE td_cards (
      lang TEXT NOT NULL, id TEXT NOT NULL, fetched_at INTEGER NOT NULL, json TEXT NOT NULL,
      PRIMARY KEY (lang, id))`)
    const ins = db.prepare('INSERT INTO td_cards VALUES (?, ?, 0, ?)')
    ins.run(
      'en',
      'dp6-136',
      JSON.stringify({
        id: 'dp6-136',
        name: 'Rotom',
        category: 'Pokemon',
        attacks: [{}, { name: 'Plasma', damage: 20 }],
        abilities: [{ type: 'Poke-BODY' }]
      })
    )
    ins.run('en', 'x-1', JSON.stringify({ id: 'x-1', category: 'Pokemon' }))
    db.close()

    const cards = readEnglishCards(path)
    expect(cards.map((c) => c.id)).toEqual(['dp6-136'])
    expect(cards[0].attacks).toEqual([{ name: 'Plasma' }])
    expect(cards[0].abilities).toEqual([])
  })
})

describe('toMtgPackCard', () => {
  it('keeps legalities, power and toughness, on the card and on each face, and drops the rest', () => {
    const card = toMtgPackCard({
      name: "Smuggler's Copter",
      layout: 'normal',
      type_line: 'Legendary Artifact — Vehicle',
      power: '3',
      toughness: '3',
      legalities: { commander: 'legal' },
      released_at: '2016-09-30',
      reprint: true,
      games: ['paper'],
      prices: { usd: '1' },
      card_faces: [
        { name: 'A', type_line: 'Creature', power: '1', toughness: '2', mana_cost: '{R}' },
        { name: 'B' }
      ]
    })
    expect(card).toMatchObject({
      power: '3',
      toughness: '3',
      legalities: { commander: 'legal' },
      reprint: true,
      card_faces: [{ name: 'A', power: '1', toughness: '2' }, { name: 'B' }]
    })
    expect(card).not.toHaveProperty('prices')
    expect(card.card_faces![0]).not.toHaveProperty('mana_cost')
  })
})
