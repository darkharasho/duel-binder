import { openCardCache, cardIsUsable, traditionalCardIsUsable } from './cache'
import { chineseCards, chineseFiles, chineseIndex, chineseListSets, chineseSet, type ZhCard } from './chinese'
import { chinesePromoSets } from './chinesePromos'
import { createLimiter, REPO_URL, MAX_CONCURRENCY, type GetJsonOpts } from './http'
import { tcgcsvCardRows, tcgcsvGroups, tcgcsvPrices, tcgcsvProducts } from './tcgcsv'
import { tcgdexCard, tcgdexSet, tcgdexSetList } from './tcgdex'
import { traditionalCard, traditionalSets } from './traditional'
import type { PkmLang, PokemonSources, TdCard } from './types'
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

/** TCGplayer doesn't sell Chinese cards, so they have no groups and the rest never runs. */
const noGroups = (lang: PkmLang): lang is 'zh-hans' | 'zh-hant' =>
  lang === 'zh-hans' || lang === 'zh-hant'

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
  /** Cards of sets built from TCGplayer (see upcoming.ts), by language and id; TCGdex would 404 them. */
  const upcoming = new Map<string, TdCard>()
  const chinese = new Map<string, TdCard>()
  return {
    async sets(lang) {
      if (lang === 'zh-hans') {
        const index = await chineseIndex(o)
        const ids = [...chineseFiles(index).keys()]
        const lists = await allOrNothing(ids, (id, oo) => chineseCards(id, oo))
        const rows = new Map<string, ZhCard[]>(ids.map((id, i) => [id, lists[i]]))
        const list = chineseListSets(index, rows)
        opts.log?.(
          `Pokémon zh-hans: ${list.sets.length + 1} sets; ${list.named} cards named from other rows, ` +
            `${list.unnamed} left unnamed, ${list.oddNumbers} odd numbers, ${list.repeats} repeats left out`
        )
        const built = [chineseSet(rows.get('30thC')!), ...list.sets, ...chinesePromoSets()]
        for (const b of built) for (const c of b.cards) chinese.set(c.id, c)
        return built.map((b) => b.set)
      }
      if (lang === 'zh-hant') {
        const list = await tcgdexSetList('zh-tw', o)
        return traditionalSets(await allOrNothing(list, (s, oo) => tcgdexSet('zh-tw', s.id, oo)))
      }
      const list = await tcgdexSetList(lang, o)
      const sets = await allOrNothing(list, (s, oo) => tcgdexSet(lang, s.id, oo))
      const paper = sets.filter((s) => !DIGITAL_SERIES.has(s.serie?.id ?? ''))
      const groups = upcomingGroups(await tcgcsvGroups(lang, o), sets, lang)
      const built = await allOrNothing(groups, async (g, oo) =>
        upcomingSet(g, await tcgcsvCardRows(lang, g.groupId, oo), lang)
      )
      for (const b of built) {
        if (!b) continue
        opts.log?.(`Pokémon ${lang}: ${b.set.name} built from TCGplayer, ${b.cards.length} cards`)
        paper.push(b.set)
        for (const c of b.cards) upcoming.set(`${lang}/${c.id}`, c)
      }
      return paper
    },
    async cards(lang, ids) {
      if (lang === 'zh-hans') return ids.flatMap((id) => chinese.get(id) ?? [])
      const t = now().getTime()
      if (lang === 'zh-hant') {
        return allOrNothing(ids, async (id, oo): Promise<TdCard> => {
          const hit = cache.get(lang, id)
          if (hit && traditionalCardIsUsable(hit.fetchedAt, t)) return traditionalCard(hit.card)
          const card = await tcgdexCard('zh-tw', id, oo)
          cache.put(lang, id, card, t)
          return traditionalCard(card)
        })
      }
      return allOrNothing(ids, async (id, oo): Promise<TdCard> => {
        const built = upcoming.get(`${lang}/${id}`)
        if (built) return built
        const hit = cache.get(lang, id)
        if (hit && cardIsUsable(hit.card, hit.fetchedAt, t)) return hit.card
        const card = await tcgdexCard(lang, id, oo)
        cache.put(lang, id, card, t)
        return card
      })
    },
    groups: async (lang) => (noGroups(lang) ? [] : tcgcsvGroups(lang, o)),
    products: async (lang, groupId) => (noGroups(lang) ? [] : tcgcsvProducts(lang, groupId, o)),
    prices: async (lang, groupId) => (noGroups(lang) ? [] : tcgcsvPrices(lang, groupId, o)),
    close: () => cache.close()
  }
}
