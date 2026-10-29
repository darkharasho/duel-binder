import { openCardCache, cardIsUsable } from './cache'
import { createLimiter, REPO_URL, MAX_CONCURRENCY, type GetJsonOpts } from './http'
import { tcgcsvGroups, tcgcsvPrices, tcgcsvProducts } from './tcgcsv'
import { tcgdexCard, tcgdexSet, tcgdexSetList } from './tcgdex'
import type { PokemonSources, TdCard } from './types'

export interface PokemonSourcesOpts {
  cachePath: string
  fetch?: typeof fetch
  version: string
  now?: () => Date
  log?: (l: string) => void
  /** Base retry backoff in ms (tests pass a tiny value). */
  retryDelayMs?: number
}

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
  return {
    async sets(lang) {
      const list = await tcgdexSetList(lang, o)
      return allOrNothing(list, (s, oo) => tcgdexSet(lang, s.id, oo))
    },
    async cards(lang, ids) {
      const t = now().getTime()
      return allOrNothing(ids, async (id, oo): Promise<TdCard> => {
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
