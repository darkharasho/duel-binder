import { describe, expect, it, vi } from 'vitest'
import type { GameId } from '../../src/shared/games'
import type { RollupJob } from '../../src/main/repo/rollupJobs'
import { createRollupWarmer } from '../../src/main/rollupWarmer'
import { openDatabase } from '../../src/main/db/database'
import { setMeta } from '../../src/main/db/meta'
import { createDataHandlers } from '../../src/main/ipc/dataHandlers'

function warmer(
  o: {
    games?: GameId[]
    shown?: GameId
    stored?: string | null
    build?: (job: RollupJob) => Promise<unknown>
  } = {}
): {
  w: ReturnType<typeof createRollupWarmer>
  build: ReturnType<typeof vi.fn>
  saved: string[]
} {
  const saved: string[] = []
  const build = vi.fn(o.build ?? (async () => ({})))
  const w = createRollupWarmer({
    build,
    games: () => o.games ?? ['ygo', 'pkm', 'op', 'mtg'],
    shownGame: () => o.shown ?? 'pkm',
    readLanguage: () => o.stored ?? null,
    saveLanguage: (v) => saved.push(v)
  })
  return { w, build, saved }
}

describe('rollup warm-up', () => {
  it("warms every game's Browse filters in English and its Sets list, the shown game first", async () => {
    const { w, build } = warmer()
    await w.warm()
    expect(build.mock.calls.map(([job]) => job)).toEqual([
      { kind: 'facets', game: 'pkm', language: 'en' },
      { kind: 'sets', game: 'pkm' },
      { kind: 'facets', game: 'ygo', language: 'en' },
      { kind: 'sets', game: 'ygo' },
      { kind: 'facets', game: 'op', language: 'en' },
      { kind: 'sets', game: 'op' },
      { kind: 'facets', game: 'mtg', language: 'en' },
      { kind: 'sets', game: 'mtg' }
    ])
  })

  it('warms the language Browse last asked for, and remembers it', () => {
    const { w, saved } = warmer({ games: ['ygo'], shown: 'ygo' })
    w.browsed('ja')
    w.browsed('ja')
    expect(saved).toEqual(['ja'])
    expect(w.jobs()[0]).toEqual({ kind: 'facets', game: 'ygo', language: 'ja' })
    // Every language: the `:all` rollup.
    w.browsed(undefined)
    expect(saved).toEqual(['ja', 'all'])
    expect(w.jobs()[0]).toEqual({ kind: 'facets', game: 'ygo', language: undefined })
  })

  it('starts from the language remembered last time', () => {
    expect(warmer({ games: ['ygo'], shown: 'ygo', stored: 'de' }).w.jobs()[0]).toMatchObject({
      language: 'de'
    })
    expect(warmer({ games: ['ygo'], shown: 'ygo', stored: 'all' }).w.jobs()[0]).toMatchObject({
      language: undefined
    })
    expect(warmer({ games: ['ygo'], shown: 'ygo', stored: 'junk' }).w.jobs()[0]).toMatchObject({
      language: 'en'
    })
  })

  it('sends one job at a time, so a page asking meanwhile waits for one build at most', async () => {
    const pending: (() => void)[] = []
    const { w, build } = warmer({
      games: ['ygo', 'mtg'],
      shown: 'ygo',
      build: () => new Promise<unknown>((r) => pending.push(() => r({})))
    })
    const done = w.warm()
    expect(build).toHaveBeenCalledTimes(1)
    pending.shift()!()
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2))
    pending.shift()!()
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(3))
    pending.shift()!()
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(4))
    pending.shift()!()
    await done
  })

  it('a newer warm-up takes over, and a failed build does not stop it', async () => {
    const { w, build } = warmer({
      games: ['ygo', 'mtg'],
      shown: 'ygo',
      build: async (job) => {
        if (job.kind === 'sets') throw new Error('boom')
        return {}
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await Promise.all([w.warm(), w.warm()])
    // The first stops after its first job; the second runs all four, past the failed Sets builds.
    expect(build).toHaveBeenCalledTimes(5)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe("Browse's filters request", () => {
  it('tells the warm-up which language Browse asks for', async () => {
    const db = openDatabase(':memory:')
    setMeta(db, 'active_game', 'ygo')
    const browsed = vi.fn()
    const h = createDataHandlers({
      db,
      onEdit: () => {},
      availableGames: () => ['ygo'],
      onGameChanged: () => {},
      browsed
    })
    await h['cards:browseFacets']('ja')
    await h['cards:browseFacets'](undefined)
    expect(browsed.mock.calls).toEqual([['ja'], [undefined]])
    db.close()
  })
})
