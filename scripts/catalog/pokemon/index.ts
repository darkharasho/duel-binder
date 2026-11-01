import type Database from 'better-sqlite3'
import { createPokemonSources } from './sources'
import type { PkmLang, PokemonSources } from './types'
import { refreshPokemon, type PokemonReport } from './write'

export type { PokemonReport } from './write'

/**
 * The languages refreshed each night; `en` first, since the others read its cards. German, Italian
 * and Spanish are ready (european.ts) and wait for French's measurements.
 */
const NIGHTLY_LANGS: PkmLang[] = ['en', 'ja', 'zh-hans', 'zh-hant', 'fr']

export interface PokemonStepOpts {
  /** The job-local source cache (catalog-work/pokemon-src.sqlite). */
  cachePath: string
  fetch?: typeof fetch
  version: string
  log: (l: string) => void
  /** Replaces the live sources (tests). */
  sources?: PokemonSources
}

/**
 * The nightly job's Pokémon step. A failing European language is dropped by refreshPokemon. Any
 * other failure (a source down, a bad response, a write error) is returned as `error`; refreshPokemon writes nothing until everything is fetched, and then in one
 * transaction, so the work database keeps the previous night's Pokémon rows.
 */
export async function runPokemonStep(
  work: Database.Database,
  opts: PokemonStepOpts
): Promise<{ reports: PokemonReport[]; error: string | null }> {
  let close: (() => void) | undefined
  try {
    let sources = opts.sources
    if (!sources) {
      const live = createPokemonSources({
        cachePath: opts.cachePath,
        fetch: opts.fetch,
        version: opts.version,
        log: opts.log
      })
      close = () => live.close()
      sources = live
    }
    const reports = await refreshPokemon(work, sources, { log: opts.log, langs: NIGHTLY_LANGS })
    return { reports, error: null }
  } catch (e) {
    return { reports: [], error: e instanceof Error ? e.message : String(e) }
  } finally {
    close?.()
  }
}
