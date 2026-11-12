import type { GameId } from '../shared/games'
import { isLanguage, type Language } from '../shared/languages'
import type { RollupJob } from './repo/rollupJobs'

/**
 * Builds, ahead of their pages, the rollups the pages ask for: each game's Sets list and its Browse
 * filters in the language Browse last asked for (English until it asks, as the language filter
 * starts there). The shown game goes first. Jobs go to the rollup worker one at a time, so a page's
 * own request waits behind at most one warm-up, never behind every game's; a stored rollup comes
 * straight back from the worker. Nothing here runs on the main process but the queueing.
 */
export interface RollupWarmer {
  /** Warms every game's rollups (after a start or a catalog change); a newer call takes over. */
  warm(): Promise<void>
  /** Browse asked for its filters in `language` (undefined: every language). */
  browsed(language: Language | undefined): void
  /** The jobs the next warm() runs, in order. */
  jobs(): RollupJob[]
}

/** Browse's language as stored: 'all' for every language. */
const ALL = 'all'

export function createRollupWarmer({
  build,
  games,
  shownGame,
  readLanguage,
  saveLanguage
}: {
  build(job: RollupJob): Promise<unknown>
  /** The games this account can show. */
  games(): GameId[]
  shownGame(): GameId
  /** The language Browse asked for last time, kept across restarts ('all' or a language). */
  readLanguage(): string | null
  saveLanguage(value: string): void
}): RollupWarmer {
  const stored = readLanguage()
  let language: Language | undefined =
    stored === ALL ? undefined : isLanguage(stored) ? stored : 'en'
  let pass = 0

  const jobs = (): RollupJob[] => {
    const shown = shownGame()
    const all = games()
    const ordered = all.includes(shown) ? [shown, ...all.filter((g) => g !== shown)] : all
    return ordered.flatMap((game): RollupJob[] => [
      { kind: 'facets', game, language },
      { kind: 'sets', game }
    ])
  }

  return {
    jobs,
    browsed(next) {
      if (next === language) return
      language = next
      try {
        saveLanguage(next ?? ALL)
      } catch {
        // Unable to write now (a catalog update holding the lock): remembered for this session.
      }
    },
    async warm() {
      const mine = ++pass
      for (const job of jobs()) {
        if (mine !== pass) return
        try {
          await build(job)
        } catch (e) {
          console.warn('Rollup build failed', e)
        }
      }
    }
  }
}
