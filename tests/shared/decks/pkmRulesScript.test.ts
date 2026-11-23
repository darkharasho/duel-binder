import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readEnglishCards } from '../../../scripts/catalog/rules'

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
    ins.run('en', 'a-1', JSON.stringify({
      id: 'a-1', name: 'Pikachu', category: 'Pokemon', stage: 'Basic', rarity: 'Common',
      legal: { standard: true, expanded: true }, attacks: [{ name: 'Gnaw', damage: 10 }],
      abilities: [{ name: 'Static', type: 'Ability' }], image: 'x'
    }))
    ins.run('en', 'a-2', JSON.stringify({
      id: 'a-2', name: 'Boss', category: 'Trainer', legal: { standard: false, expanded: true }
    }))
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
})
