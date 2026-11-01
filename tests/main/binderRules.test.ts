import type { SqlDb } from '../../src/main/db/sql'
import { LOCAL, localScope } from '../../src/main/repo/scope'
import {
  matchedPrintingCount,
  narrowedRuleSql,
  ruleFieldValues,
  ruleSql
} from '../../src/main/repo/binderRules'
import type { BinderRule, BinderRules } from '../../src/shared/binders'
import { seedPokemon } from '../fixtures/pokemon'
import { seededDb } from './helpers'

const rules = (...r: BinderRule[]): BinderRules => ({ version: 1, rules: r })
const find = (db: SqlDb, r: BinderRules, langs: string[] = []): string[] => {
  const w = ruleSql(r, langs as never)
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
const findPkm = (db: SqlDb, r: BinderRules): string[] => {
  const w = ruleSql(r, [])
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

describe('rule queries narrowed through the cards', () => {
  const YGO = localScope("'ygo'")
  const PKM = localScope("'pkm'")
  const printings = (db: SqlDb, sql: string, params: unknown[], scope = YGO): number[] =>
    (
      db
        .prepare(
          `SELECT p.id FROM card_printings p JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
           LEFT JOIN pokemon_cards pc ON pc.card_id = c.id WHERE +p.game = ${scope.game} AND ${sql}`
        )
        .all(...params) as { id: number }[]
    )
      .map((r) => r.id)
      .sort((a, b) => a - b)
  const expectSame = (db: SqlDb, r: BinderRules, langs: never[] = [], scope = YGO): void => {
    const full = ruleSql(r, langs)
    const narrowed = narrowedRuleSql(db, r, langs, scope)
    expect(printings(db, narrowed.sql, narrowed.params, scope)).toEqual(
      printings(db, full.sql, full.params, scope)
    )
  }

  it('matches exactly what the plain rule matches, whichever field drives', async () => {
    const db = await seededDb()
    expectSame(db, rules({ field: 'name', op: 'is', value: 'DARK magician' }))
    expectSame(db, rules({ field: 'name', op: 'contains', value: 'magic' }))
    expectSame(db, rules({ field: 'name', op: 'is', value: 'No Such Card' }))
    expectSame(db, rules({ field: 'level', values: ['7'] }))
    expectSame(db, rules({ field: 'cardType', values: ['Spell Card'] }, { field: 'rarity', values: ['Common'] }))
    expectSame(db, rules({ field: 'race', values: ['Spellcaster'] }, { field: 'set', values: ['Legend of Blue Eyes White Dragon'] }))
    expectSame(db, rules({ field: 'rarity', values: ['Ultra Rare'] }))
    expectSame(db, rules({ field: 'name', op: 'is', value: 'Dark Magician' }), ['de' as never])
    expectSame(
      db,
      rules({ field: 'name', op: 'contains', value: 'Dark' }, { field: 'name', op: 'is', value: 'Dark Magician' })
    )
    expectSame(
      db,
      rules({ field: 'name', op: 'is', value: 'Dark Magician' }, { field: 'name', op: 'is', value: 'Pot of Greed' })
    )
  })

  it('finds Pokémon cards by either name, and by artist and energy', async () => {
    const db = await seededDb()
    seedPokemon(db)
    const local = 'Pikachu-Local'
    const { illustrator } = db
      .prepare(
        `UPDATE pokemon_cards SET local_name = ?
         WHERE card_id = (SELECT MIN(card_id) FROM pokemon_cards) RETURNING illustrator`
      )
      .get(local) as { illustrator: string }
    expectSame(db, rules({ field: 'name', op: 'is', value: local.toUpperCase() }), [], PKM)
    expectSame(db, rules({ field: 'name', op: 'contains', value: local.slice(0, 2) }), [], PKM)
    expectSame(db, rules({ field: 'artist', values: [illustrator] }), [], PKM)
    expectSame(db, rules({ field: 'energyType', values: ['Fire'] }), [], PKM)
    const { stage } = db.prepare('SELECT stage FROM pokemon_cards WHERE stage IS NOT NULL LIMIT 1').get() as {
      stage: string
    }
    expectSame(db, rules({ field: 'stage', values: [stage] }), [], PKM)
    const named = { field: 'name', op: 'is', value: local } as const
    expectSame(db, rules(named, { field: 'artist', values: [illustrator] }), [], PKM)
    expectSame(db, rules(named, { field: 'artist', values: ['Nobody'] }), [], PKM)
    expectSame(db, rules({ field: 'name', op: 'contains', value: 'a' }, { field: 'artist', values: [illustrator] }), [], PKM)
    const byLocal = narrowedRuleSql(db, rules({ field: 'name', op: 'is', value: local }), [], PKM)
    expect(printings(db, byLocal.sql, byLocal.params, PKM).length).toBeGreaterThan(0)
  })

  it('falls back to the plain condition past the candidate limit, with the same printings', async () => {
    const db = await seededDb()
    const r = rules({ field: 'name', op: 'contains', value: 'a' }, { field: 'rarity', values: ['Ultra Rare'] })
    const narrowed = narrowedRuleSql(db, r, [], YGO)
    const candidates = (JSON.parse(narrowed.params[0] as string) as number[]).length
    expect(candidates).toBeGreaterThan(1)
    expect(narrowedRuleSql(db, r, [], YGO, undefined, candidates).sql).toBe(narrowed.sql)

    const plain = narrowedRuleSql(db, r, [], YGO, undefined, candidates - 1)
    expect(plain).toEqual(ruleSql(r, []))
    expect(printings(db, plain.sql, plain.params)).toEqual(printings(db, narrowed.sql, narrowed.params))
    expect(printings(db, plain.sql, plain.params).length).toBeGreaterThan(0)
  })

  it('a rarity and a name must hold for one printing, not across two', async () => {
    const db = await seededDb()
    const id = (db.prepare("SELECT id FROM cards WHERE name = 'Dark Magician'").get() as { id: number }).id
    db.prepare('DELETE FROM card_printings WHERE card_id = ?').run(id)
    const ins = db.prepare(
      "INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity) VALUES ('ygo', ?, ?, ?, ?, ?)"
    )
    ins.run(id, 'en', 'First', 'F-001', 'Common')
    ins.run(id, 'de', 'Second', 'S-001', 'Ultra Rare')
    const name = { field: 'name', op: 'is', value: 'Dark Magician' } as const
    const rare = rules(name, { field: 'rarity', values: ['Ultra Rare'] })
    expect(matchedPrintingCount(db, rare, [], YGO, 100)).toBe(1)
    // Each language alone has one of the two; none has both.
    expect(matchedPrintingCount(db, rare, ['en'], YGO, 100)).toBe(0)
    expect(matchedPrintingCount(db, rules(name), [], YGO, 100)).toBe(2)
  })

  it('counts narrowed printings up to cap + 1', async () => {
    const db = await seededDb()
    const name = rules({ field: 'name', op: 'contains', value: 'a' })
    const total = matchedPrintingCount(db, name, [], YGO, 100000)
    expect(total).toBeGreaterThanOrEqual(2)
    expect(matchedPrintingCount(db, name, [], YGO, total)).toBe(total)
    expect(matchedPrintingCount(db, name, [], YGO, total - 1)).toBe(total)
    expect(matchedPrintingCount(db, name, [], YGO, 1)).toBe(2)
    expect(matchedPrintingCount(db, rules({ field: 'name', op: 'is', value: 'No Such Card' }), [], YGO, 1)).toBe(0)
  })

  it('reads printings by card, never scanning them, when a card field drives', async () => {
    const db = await seededDb()
    seedPokemon(db)
    const plan = (r: BinderRules, scope = YGO): string => {
      const w = narrowedRuleSql(db, r, [], scope)
      return (
        db
          .prepare(
            `EXPLAIN QUERY PLAN SELECT p.id FROM card_printings p JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
             LEFT JOIN pokemon_cards pc ON pc.card_id = c.id WHERE +p.game = ${scope.game} AND ${w.sql}`
          )
          .all(...w.params) as { detail: string }[]
      )
        .map((d) => d.detail)
        .join('\n')
    }
    for (const [r, scope] of [
      [rules({ field: 'name', op: 'is', value: 'Dark Magician' }), YGO],
      [rules({ field: 'name', op: 'contains', value: 'Dark' }), YGO],
      [rules({ field: 'race', values: ['Spellcaster'] }), YGO],
      [rules({ field: 'artist', values: ['Asako Ito'] }), PKM]
    ] as const) {
      const text = plan(r, scope)
      expect(text).toContain('ix_printings_card')
      expect(text).not.toMatch(/SCAN p\b/)
    }
    expect(plan(rules({ field: 'set', values: ['Legend of Blue Eyes White Dragon'] }))).toContain(
      'ix_printings_set_name'
    )
  })

  it('finds the candidate cards through their indexes', async () => {
    const db = await seededDb()
    seedPokemon(db)
    const details = (sql: string, ...params: unknown[]): string =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((d) => d.detail).join('\n')
    expect(details("SELECT c.id FROM cards c WHERE c.name = ? COLLATE NOCASE AND +c.game = 'ygo'", 'x')).toContain('ix_cards_name')
    expect(details('SELECT pc.card_id FROM pokemon_cards pc WHERE pc.local_name = ? COLLATE NOCASE', 'x')).toContain(
      'ix_pokemon_cards_local_name'
    )
  })
})
