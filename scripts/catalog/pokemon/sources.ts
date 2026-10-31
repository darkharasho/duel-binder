import { openCardCache, cardIsUsable } from './cache'
import { createLimiter, REPO_URL, MAX_CONCURRENCY, type GetJsonOpts } from './http'
import { tcgcsvCardRows, tcgcsvGroups, tcgcsvPrices, tcgcsvProducts } from './tcgcsv'
import { tcgdexCard, tcgdexSet, tcgdexSetList } from './tcgdex'
import type { PokemonSources, TdCard } from './types'
import { upcomingGroups, upcomingSet } from './upcoming'

export interface PokemonSourcesOpts {
  cachePath: string
  fetch?: typeof fetch
  version: string
  now?: () => Date
  log?: (l: string) => void
  /** Base retry backoff in ms (tests pass a tiny value). */
  retryDelayMs?: number
}

/** TCGdex series with no physical cards (Pokémon TCG Pocket); a binder only holds paper. */
const DIGITAL_SERIES = new Set(['tcgp'])

export function createPokemonSources(opts: PokemonSourcesOpts): PokemonSources & { close(): void } {
  const cache = openCardCache(opts.cachePath)
  const now = opts.now ?? (() => new Date())
  const o: GetJsonOpts = {
    fetch: opts.fetch ?? fetch,
    userAgent: `DuelBinder/${opts.version} (${REPO_URL})`,
    limiter: createLimiter(MAX_CONCURRENCY),
    retryDelayMs: opts.retryDelayMs,
    log: opts.log
  }
  /**
   * Promise.all over `items`, except that the first failure stops the requests still queued: the
   * night's Pokémon refresh is abandoned anyway, and thousands of card requests would otherwise
   * keep hitting TCGdex (and the closed cache) after the step had given up.
   */
  const allOrNothing = async <T, R>(
    items: T[],
    fn: (item: T, o: GetJsonOpts) => Promise<R>
  ): Promise<R[]> => {
    const ac = new AbortController()
    const oo = { ...o, signal: ac.signal }
    return Promise.all(
      items.map((x) =>
        fn(x, oo).catch((e: unknown) => {
          ac.abort()
          throw e
        })
      )
    )
  }
  /** Cards of sets built from TCGplayer (see upcoming.ts); TCGdex would 404 them. */
  const upcoming = new Map<string, TdCard>()
  return {
    async sets(lang) {
      const list = await tcgdexSetList(lang, o)
      const sets = await allOrNothing(list, (s, oo) => tcgdexSet(lang, s.id, oo))
      const paper = sets.filter((s) => !DIGITAL_SERIES.has(s.serie?.id ?? ''))
      if (lang !== 'en') return paper
      const groups = upcomingGroups(await tcgcsvGroups(lang, o), sets)
      const built = await allOrNothing(groups, async (g, oo) =>
        upcomingSet(g, await tcgcsvCardRows(lang, g.groupId, oo))
      )
      for (const b of built) {
        if (!b) continue
        opts.log?.(`Pokémon en: ${b.set.name} built from TCGplayer, ${b.cards.length} cards`)
        paper.push(b.set)
        for (const c of b.cards) upcoming.set(c.id, c)
      }
      return paper
    },
    async cards(lang, ids) {
      const t = now().getTime()
      return allOrNothing(ids, async (id, oo): Promise<TdCard> => {
        const built = lang === 'en' ? upcoming.get(id) : undefined
        if (built) return built
        const hit = cache.get(lang, id)
        if (hit && cardIsUsable(hit.card, hit.fetchedAt, t)) return hit.card
        const card = await tcgdexCard(lang, id, oo)
        cache.put(lang, id, card, t)
        return card
      })
    },
    groups: (lang) => tcgcsvGroups(lang, o),
    products: (lang, groupId) => tcgcsvProducts(lang, groupId, o),
    prices: (lang, groupId) => tcgcsvPrices(lang, groupId, o),
    close: () => cache.close()
  }
}
