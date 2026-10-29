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
  return {
    async sets(lang) {
      const list = await tcgdexSetList(lang, o)
      return Promise.all(list.map((s) => tcgdexSet(lang, s.id, o)))
    },
    async cards(lang, ids) {
      const t = now().getTime()
      const out = await Promise.all(ids.map(async (id): Promise<TdCard> => {
        const hit = cache.get(lang, id)
        if (hit && cardIsUsable(hit.card, hit.fetchedAt, t)) return hit.card
        const card = await tcgdexCard(lang, id, o)
        cache.put(lang, id, card, t)
        return card
      }))
      return out
    },
    groups: (lang) => tcgcsvGroups(lang, o),
    products: (lang, groupId) => tcgcsvProducts(lang, groupId, o),
    prices: (lang, groupId) => tcgcsvPrices(lang, groupId, o),
    close: () => cache.close()
  }
}
