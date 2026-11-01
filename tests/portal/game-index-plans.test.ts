import { beforeAll, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { SqlDb } from '../../src/main/db/sql'
import { previewBinder } from '../../src/main/repo/binders'
import { browseCards, browseFacets } from '../../src/main/repo/browse'
import { getChecklist, listSets } from '../../src/main/repo/sets'
import { countCandidates, priceCandidates } from '../../src/main/prices/candidates'
import { priceChanges, pricesFor } from '../../workers/portal/src/sync'
import { getCardDetail, searchCards } from '../../src/main/repo/cards'
import { getFacets, listEntries } from '../../src/main/repo/collection'
import { getStats } from '../../src/main/repo/stats'
import { catalogChanges } from '../../workers/portal/src/catalogFeed'
import { userScope } from '../../workers/portal/src/scope'
import type { BinderRule } from '../../src/shared/binders'
import { addUser, seededServerDb } from './helpers'

// The server has `(game, catalog_seq)` indexes for the per-game catalog feed. With no ANALYZE stats
// the planner treats `game = ?` as selective, so any other query filtering on game would walk every
// row of the game through them. Only the catalog feed may search them; everything else writes `+x.game`.
// A full `SCAN … USING INDEX ix_*_game_seq` (a whole-table walk the query needs anyway, as main's
// `SCAN c USING ix_cards_catalog_seq`) is fine; a `SEARCH` on `game=?` is what walks every row of the game.

const GAME_INDEX = /^SEARCH .*\bix_\w+_game_seq\b/

/** Wraps `db` so every statement run through it records its EXPLAIN QUERY PLAN lines. */
function planned(db: Database.Database): { sql: SqlDb; plans: string[][] } {
  const plans: string[][] = []
  const sql: SqlDb = {
    prepare(text) {
      const stmt = db.prepare(text)
      const explain = (params: unknown[]): void => {
        const rows = db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...params) as { detail: string }[]
        plans.push(rows.map((r) => r.detail))
      }
      return {
        all: (...p) => (explain(p), stmt.all(...p)),
        get: (...p) => (explain(p), stmt.get(...p)),
        run: (...p) => stmt.run(...p)
      }
    },
    exec: (text) => void db.exec(text),
    transaction: (fn) => db.transaction(fn)
  }
  return { sql, plans }
}

const gameIndexLines = (plans: string[][]): string[] => plans.flat().filter((d) => GAME_INDEX.test(d))

describe('game index plans on a migrated server', () => {
  let db: Database.Database
  let userId: number
  beforeAll(async () => {
    db = await seededServerDb()
    userId = addUser(db, 'd1', 'alice')
  })

  const preview = (sql: SqlDb, ...rules: BinderRule[]): unknown =>
    previewBinder(
      sql,
      { name: 'x', rules: { version: 1, rules }, goal: 'card', languages: [], friendsVisible: false },
      userScope(userId, 'ygo')
    )

  const notOnGameIndex: [string, (sql: SqlDb) => unknown][] = [
    ['binder name rule', (sql) => preview(sql, { field: 'name', op: 'is', value: 'x' })],
    ['binder contains rule', (sql) => preview(sql, { field: 'name', op: 'contains', value: 'x' })],
    ['binder archetype rule', (sql) => preview(sql, { field: 'archetype', values: ['x'] })],
    ['binder set rule', (sql) => preview(sql, { field: 'set', values: ['x'] })],
    ['binder rarity rule', (sql) => preview(sql, { field: 'rarity', values: ['x'] })],
    ['browseCards page', (sql) => browseCards(sql, { sort: 'name', dir: 'asc' }, userScope(userId, 'ygo'))],
    ['browseCards search', (sql) => browseCards(sql, { q: 'LOB', sort: 'name', dir: 'asc' }, userScope(userId, 'ygo'))],
    [
      'browseCards printing filter',
      (sql) =>
        browseCards(sql, { setNames: ['x'], rarities: ['Common'], sort: 'released', dir: 'asc' }, userScope(userId, 'ygo'))
    ],
    ['browseFacets', (sql) => browseFacets(sql, userScope(userId, 'ygo'))],
    ['listSets', (sql) => listSets(sql, userScope(userId, 'ygo'))],
    ['getChecklist', (sql) => getChecklist(sql, 'x', 'en', userScope(userId, 'ygo'))],
    ['searchCards', (sql) => searchCards(sql, 'LOB', 20, userScope(userId, 'ygo'))],
    ['getCardDetail', (sql) => getCardDetail(sql, 1, userScope(userId, 'ygo'))],
    ['listEntries', (sql) => listEntries(sql, { sort: 'name', dir: 'asc' }, userScope(userId, 'ygo'))],
    ['getFacets', (sql) => getFacets(sql, userScope(userId, 'ygo'))],
    ['getStats', (sql) => getStats(sql, userScope(userId, 'ygo'))],
    ['priceChanges', (sql) => priceChanges(sql, 0)],
    ['pricesFor', (sql) => pricesFor(sql, ['x'], ['ygo'])],
    ['priceCandidates', (sql) => priceCandidates(sql, new Date('2026-10-29T00:00:00Z'))],
    ['countCandidates', (sql) => countCandidates(sql, new Date('2026-10-29T00:00:00Z'))]
  ]

  for (const [name, run] of notOnGameIndex) {
    it(`${name} does not use an ix_*_game_seq index`, () => {
      const { sql, plans } = planned(db)
      run(sql)
      expect(plans.length).toBeGreaterThan(0)
      expect(gameIndexLines(plans)).toEqual([])
    })
  }

  it('binder rules reach cards and printings through their own indexes', () => {
    const { sql, plans } = planned(db)
    preview(sql, { field: 'name', op: 'is', value: 'x' })
    preview(sql, { field: 'archetype', values: ['x'] })
    preview(sql, { field: 'set', values: ['x'] })
    const lines = plans.flat().join('\n')
    for (const index of ['ix_cards_name', 'ix_cards_archetype', 'ix_printings_set_name'])
      expect(lines).toContain(index)
  })

  it('the per-game catalog feed uses the ix_*_game_seq indexes', () => {
    const { sql, plans } = planned(db)
    catalogChanges(sql, 0, 100, undefined, 'ygo')
    const used = gameIndexLines(plans)
    for (const table of ['cards', 'card_images', 'card_printings', 'sets']) {
      expect(used.some((d) => d.includes(`ix_${table}_game_seq`))).toBe(true)
    }
  })

  it('the legacy catalog feed uses them too', () => {
    const { sql, plans } = planned(db)
    catalogChanges(sql, 0, 100)
    expect(gameIndexLines(plans).length).toBeGreaterThan(0)
  })
})
