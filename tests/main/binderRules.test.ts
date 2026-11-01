import type { SqlDb } from '../../src/main/db/sql'
import { LOCAL, localScope } from '../../src/main/repo/scope'
import { matchedPrintingCount, ruleFieldValues, ruleSql } from '../../src/main/repo/binderRules'
import type { BinderRule } from '../../src/shared/binders'
import { seedPokemon } from '../fixtures/pokemon'
import { seededDb } from './helpers'

const rules = (...r: BinderRule[]) => ({ version: 1, rules: r })
const find = (db: SqlDb, r: ReturnType<typeof rules>, langs: string[] = []): string[] => {
  const w = ruleSql(r, langs as never, LOCAL)
  return (
    db
      .prepare(
        `SELECT c.name || '|' || p.set_name || '|' || p.set_rarity AS k FROM card_printings p
         JOIN cards c ON c.id = p.card_id AND +c.game = 'ygo' LEFT JOIN pokemon_cards pc ON pc.card_id = c.id
         WHERE +p.game = 'ygo' AND ${w.sql} ORDER BY k`
      )
      .all(...w.params) as { k: string }[]
  ).map((x) => x.k)
}
const findPkm = (db: SqlDb, r: ReturnType<typeof rules>): string[] => {
  const w = ruleSql(r, [], LOCAL)
  return (
    db
      .prepare(
        `SELECT DISTINCT c.name AS k FROM card_printings p JOIN cards c ON c.id = p.card_id AND +c.game = 'pkm'
         LEFT JOIN pokemon_cards pc ON pc.card_id = c.id WHERE +p.game = 'pkm' AND ${w.sql} ORDER BY k`
      )
      .all(...w.params) as { k: string }[]
  ).map((x) => x.k)
}

describe('binder rules to SQL', () => {
  it('a name rule finds every printing of a card', async () => {
    const db = await seededDb()
    const total = (db.prepare("SELECT COUNT(*) AS n FROM card_printings p JOIN cards c ON c.id=p.card_id WHERE c.name='Dark Magician'").get() as { n: number }).n
    expect(total).toBeGreaterThan(0)
    expect(find(db, rules({ field: 'name', op: 'is', value: 'dark magician' }))).toHaveLength(total)
    expect(find(db, rules({ field: 'name', op: 'contains', value: 'magic' }))).toHaveLength(total)
  })

  it('contains treats % and _ literally', async () => {
    const db = await seededDb()
    expect(find(db, rules({ field: 'name', op: 'contains', value: '%' }))).toEqual([])
    expect(find(db, rules({ field: 'name', op: 'contains', value: 'Dark_Magician' }))).toEqual([])
  })

  it('rarity and set must hold for one printing', async () => {
    const db = await seededDb()
    const id = (db.prepare("SELECT id FROM cards WHERE name = 'Dark Magician'").get() as { id: number }).id
    db.prepare('DELETE FROM card_printings WHERE card_id = ?').run(id)
    const ins = db.prepare(
      "INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity) VALUES ('ygo', ?, 'en', ?, ?, ?)"
    )
    ins.run(id, 'Legend of Blue Eyes', 'LOB-005', 'Common')
    ins.run(id, 'Other Set', 'OTH-005', 'Ultra Rare')
    const both = rules(
      { field: 'set', values: ['Legend of Blue Eyes'] },
      { field: 'rarity', values: ['Ultra Rare'] }
    )
    expect(find(db, both)).toEqual([])
    expect(find(db, rules({ field: 'set', values: ['Legend of Blue Eyes'] }, { field: 'rarity', values: ['Common'] }))).toHaveLength(1)
  })

  it('languages limit the result', async () => {
    const db = await seededDb()
    const id = (db.prepare("SELECT id FROM cards WHERE name = 'Dark Magician'").get() as { id: number }).id
    db.prepare(
      "INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity) VALUES ('ygo', ?, 'de', 'Set DE', 'X-DE001', 'Common')"
    ).run(id)
    const r = rules({ field: 'name', op: 'is', value: 'Dark Magician' })
    expect(find(db, r, ['de'])).toEqual(['Dark Magician|Set DE|Common'])
    expect(find(db, r).length).toBeGreaterThan(1)
  })

  it('level and cardType work on YGO columns', async () => {
    const db = await seededDb()
    expect(find(db, rules({ field: 'level', values: ['7'] })).every((k) => k.startsWith('Dark Magician'))).toBe(true)
    expect(find(db, rules({ field: 'level', values: ['7'] })).length).toBeGreaterThan(0)
  })

  it('Pokemon rules: local_name, artist, energyType', async () => {
    const db = await seededDb()
    seedPokemon(db)
    db.prepare("UPDATE pokemon_cards SET local_name = 'Pikachu JP' WHERE source_id = 'ja/SV2D-030'").run()
    expect(findPkm(db, rules({ field: 'name', op: 'contains', value: 'pikachu jp' }))).toEqual(['ピカチュウ'])
    expect(findPkm(db, rules({ field: 'artist', values: ['Atsuko Nishida'] }))).toEqual(['ピカチュウ'])
    expect(findPkm(db, rules({ field: 'energyType', values: ['Lightning'] }))).toEqual(['Pikachu', 'ピカチュウ'])
    expect(findPkm(db, rules({ field: 'energyType', values: ['Fire'] }))).toEqual([])
  })

  it('matchedPrintingCount stops at cap + 1', async () => {
    const db = await seededDb()
    const all = rules()
    expect(matchedPrintingCount(db, all, [], LOCAL, 1)).toBe(2)
    expect(matchedPrintingCount(db, all, [], LOCAL, 100000)).toBeLessThan(100000)
  })

  it('ruleFieldValues returns distinct matching values', async () => {
    const db = await seededDb()
    seedPokemon(db)
    expect(ruleFieldValues(db, 'cardType', 'spell', LOCAL)).toContain('Spell Card')
    expect(ruleFieldValues(db, 'energyType', 'light', localScope("'pkm'"))).toEqual(['Lightning'])
    expect(ruleFieldValues(db, 'rarity', '', LOCAL).length).toBeLessThanOrEqual(50)
  })
})
