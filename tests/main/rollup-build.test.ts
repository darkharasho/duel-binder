import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { setMeta } from '../../src/main/db/meta'
import { browseFacets, browseFacetsFast } from '../../src/main/repo/browse'
import { listSets, listSetsFast, setsRollupKey } from '../../src/main/repo/sets'
import { buildRollup, rollupJobKey, type RollupJob } from '../../src/main/repo/rollupJobs'
import { readRollup } from '../../src/main/repo/rollup'
import { createDataHandlers } from '../../src/main/ipc/dataHandlers'
import { createRollupRunner } from '../../src/main/rollupRunner'
import type { SqlDb } from '../../src/main/db/sql'

let db: Database.Database
afterEach(() => db?.close())

type Game = 'ygo' | 'pkm' | 'mtg'
let nextPrinting = 1

function card(id: number, game: Game, name: string): void {
  db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, ?, ?, 'Normal Monster', 'normal', 'Dragon', '', '2026-01-01')`
  ).run(id, game, name)
  db.prepare(
    'INSERT INTO card_images (image_id, card_id, game, sort_order) VALUES (?, ?, ?, 0)'
  ).run(id, id, game)
}

function printing(cardId: number, game: Game, setName: string): void {
  db.prepare(
    `INSERT INTO card_printings (card_id, game, set_name, set_code, set_rarity) VALUES (?, ?, ?, ?, 'Rare')`
  ).run(cardId, game, setName, `X-${nextPrinting++}`)
}

function setup(): void {
  db = openDatabase(':memory:')
  setMeta(db, 'active_game', 'ygo')
  card(1, 'ygo', 'Alpha')
  printing(1, 'ygo', 'First Set')
  card(2, 'pkm', 'Sprout')
  printing(2, 'pkm', 'Base')
  card(3, 'mtg', 'Bolt')
  printing(3, 'mtg', 'Alpha Edition')
  db.prepare("INSERT INTO sets (game, set_name, set_code) VALUES ('pkm', 'Base', 'BS')").run()
}

const keys = (): string[] =>
  (db.prepare('SELECT key FROM catalog_rollups ORDER BY key').all() as { key: string }[]).map(
    (r) => r.key
  )

/** Every game's Sets list stored. */
function storeAll(): void {
  for (const g of ['ygo', 'pkm', 'mtg'] as const) buildRollup(db, { kind: 'sets', game: g })
}

describe('rollups by game', () => {
  const writes: [string, Game, () => void][] = [
    ['a Pokémon printing', 'pkm', () => printing(2, 'pkm', 'Jungle')],
    [
      'a Magic card text',
      'mtg',
      () => db.exec("INSERT INTO mtg_cards (card_id, oracle_id) VALUES (3, 'o')")
    ],
    [
      'a Pokémon set row',
      'pkm',
      () => db.exec("UPDATE sets SET set_code = 'BS1' WHERE game = 'pkm'")
    ],
    [
      'Yu-Gi-Oh! pack art',
      'ygo',
      () => db.exec("INSERT INTO pack_art VALUES ('First Set', 'u', 'k')")
    ],
    [
      'Pokémon set art',
      'pkm',
      () => db.exec("INSERT INTO pokemon_set_art VALUES ('en', 'Base', 'pack', 0, 'u', 'k')")
    ],
    [
      'a Magic image',
      'mtg',
      () => db.exec('UPDATE card_images SET sort_order = 1 WHERE image_id = 3')
    ]
  ]
  it.each(writes)('%s drops only that game', (_, game, write) => {
    setup()
    storeAll()
    write()
    expect(keys()).toEqual(
      (['ygo', 'pkm', 'mtg'] as const)
        .filter((g) => g !== game)
        .map((g) => setsRollupKey(g))
        .sort()
    )
  })

  it('a printing moved to another game drops both', () => {
    setup()
    storeAll()
    db.exec("UPDATE card_printings SET game = 'mtg' WHERE card_id = 2")
    expect(keys()).toEqual([setsRollupKey('ygo')])
  })
})

describe('buildRollup', () => {
  it('stores what listSetsFast and browseFacetsFast would, for its own game whatever is shown', () => {
    setup()
    expect(buildRollup(db, { kind: 'sets', game: 'pkm' })).toEqual(
      (setMeta(db, 'active_game', 'pkm'), listSets(db).map((s) => ({ ...s })))
    )
    const facets = buildRollup(db, { kind: 'facets', game: 'pkm' })
    expect(facets).toEqual(browseFacets(db))
    expect(keys()).toEqual(
      [setsRollupKey('pkm'), rollupJobKey({ kind: 'facets', game: 'pkm' })].sort()
    )
    expect(browseFacetsFast(db)).toEqual(facets)
    expect(listSetsFast(db)).toEqual(listSets(db))
  })

  it('returns a stored rollup without building', () => {
    setup()
    buildRollup(db, { kind: 'sets', game: 'ygo' })
    db.prepare('UPDATE catalog_rollups SET value = ? WHERE key = ?').run(
      '"kept"',
      setsRollupKey('ygo')
    )
    expect(buildRollup(db, { kind: 'sets', game: 'ygo' })).toBe('kept')
  })

  /** `db` with `write` run as each build's snapshot opens: the catalog changing while it builds. */
  const changingWhileBuilding = (times: number, write: () => void): SqlDb => {
    let left = times
    return {
      prepare: (sql) => db.prepare(sql),
      transaction: (fn) => db.transaction(fn),
      exec: (sql) => {
        db.exec(sql)
        if (sql === 'BEGIN' && left-- > 0) write()
      }
    }
  }

  it("starts over when the game's catalog changes while it builds", () => {
    setup()
    let n = 0
    const value = buildRollup(
      changingWhileBuilding(1, () => printing(2, 'pkm', `New ${n++}`)),
      { kind: 'sets', game: 'pkm' }
    )
    setMeta(db, 'active_game', 'pkm')
    expect(value).toEqual(listSets(db))
    expect(readRollup(db, setsRollupKey('pkm'))).toEqual(listSets(db))
    expect(keys()).toEqual([setsRollupKey('pkm')])
  })

  it("keeps a build when another game's catalog changes meanwhile", () => {
    setup()
    const spy = vi.fn(() => printing(3, 'mtg', 'Beta Edition'))
    buildRollup(changingWhileBuilding(5, spy), { kind: 'sets', game: 'pkm' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(keys()).toEqual([setsRollupKey('pkm')])
  })

  it('stores nothing when the catalog keeps changing', () => {
    setup()
    let n = 0
    const value = buildRollup(
      changingWhileBuilding(10, () => printing(2, 'pkm', `New ${n++}`)),
      { kind: 'sets', game: 'pkm' }
    )
    expect((value as unknown[]).length).toBeGreaterThan(0)
    expect(keys()).toEqual([])
  })
})

describe('sets:list and cards:browseFacets with a rollup builder', () => {
  const handlers = (build: (job: RollupJob) => Promise<unknown>) =>
    createDataHandlers({
      db,
      onEdit: () => {},
      availableGames: () => ['ygo', 'pkm', 'mtg'],
      onGameChanged: () => {},
      buildRollup: build
    })

  it('builds a missing rollup through the builder, and reads a stored one', async () => {
    setup()
    const build = vi.fn(async (job: RollupJob) => buildRollup(db, job))
    const h = handlers(build)
    expect(await h['sets:list']()).toEqual(listSets(db))
    expect(await h['cards:browseFacets'](undefined)).toEqual(browseFacets(db))
    expect(build.mock.calls.map(([job]) => job)).toEqual([
      { kind: 'sets', game: 'ygo' },
      { kind: 'facets', game: 'ygo', language: undefined }
    ])
    await h['sets:list']()
    await h['cards:browseFacets'](undefined)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('uses what the builder returns when it could not store it', async () => {
    setup()
    const h = handlers(async (job) => {
      const v = buildRollup(db, job)
      db.exec('DELETE FROM catalog_rollups')
      return v
    })
    expect(await h['sets:list']()).toEqual(listSets(db))
    expect(keys()).toEqual([])
  })

  it('reads the shown game when the game changed while it built', async () => {
    setup()
    const h = handlers(async (job) => {
      const v = buildRollup(db, job)
      setMeta(db, 'active_game', 'mtg')
      return v
    })
    expect(((await h['sets:list']()) as { setName: string }[]).map((s) => s.setName)).toEqual([
      'Alpha Edition'
    ])
  })

  it('builds in line when the builder fails', async () => {
    setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = handlers(async () => {
      throw new Error('worker died')
    })
    expect(await h['sets:list']()).toEqual(listSets(db))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('createRollupRunner', () => {
  class FakeWorker extends EventEmitter {
    posted: { id: number; job: RollupJob }[] = []
    postMessage(m: { id: number; job: RollupJob }): void {
      this.posted.push(m)
    }
    unref(): this {
      return this
    }
    terminate(): Promise<number> {
      return Promise.resolve(0)
    }
  }

  it('shares one build per rollup and answers each job', async () => {
    const w = new FakeWorker()
    const start = vi.fn(() => w as unknown as Worker)
    const runner = createRollupRunner(start)
    const a = runner.build({ kind: 'sets', game: 'mtg' })
    const b = runner.build({ kind: 'sets', game: 'mtg' })
    const c = runner.build({ kind: 'facets', game: 'mtg' })
    expect(w.posted).toHaveLength(2)
    w.emit('message', { id: w.posted[1].id, value: 'facets' })
    w.emit('message', { id: w.posted[0].id, value: 'sets' })
    expect(await a).toBe('sets')
    expect(await b).toBe('sets')
    expect(await c).toBe('facets')
    expect(start).toHaveBeenCalledTimes(1)
    runner.build({ kind: 'sets', game: 'mtg' })
    expect(w.posted).toHaveLength(3)
  })

  it('fails waiting jobs when the worker dies, and starts a new one for the next', async () => {
    const workers = [new FakeWorker(), new FakeWorker()]
    let i = 0
    const runner = createRollupRunner(() => workers[i++] as unknown as Worker)
    const a = runner.build({ kind: 'sets', game: 'mtg' })
    workers[0].emit('exit', 1)
    await expect(a).rejects.toThrow('exited')
    const b = runner.build({ kind: 'sets', game: 'mtg' })
    workers[1].emit('message', { id: workers[1].posted[0].id, error: 'disk' })
    await expect(b).rejects.toThrow('disk')
  })
})
