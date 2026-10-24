import type { Api } from '@shared/ipc'
import type { CollectionFilters } from '@shared/types'

/** Typed accessor for `window.api`; resolved lazily so tests can install a mock first. */
export const api: Api = new Proxy({} as Api, {
  get: (_target, key) => window.api[key as keyof Api]
})

/** Every mutation invalidates entries, facets, stats and forCard. */
export const queryKeys = {
  entries: (f: CollectionFilters) => ['entries', f] as const,
  facets: ['facets'] as const,
  stats: ['stats'] as const,
  sync: ['sync'] as const,
  search: (q: string) => ['search', q] as const,
  card: (id: number) => ['card', id] as const,
  forCard: (id: number) => ['forCard', id] as const,
  update: ['update'] as const
}

/** Query-key prefixes to invalidate after any collection mutation. */
export const mutationInvalidationKeys = [['entries'], ['facets'], ['stats'], ['forCard']] as const
