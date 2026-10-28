import type { Api } from '@shared/ipc'
import type { Language } from '@shared/languages'
import type { BrowseFilters, CollectionFilters } from '@shared/types'

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
  ripSets: ['rip', 'sets'] as const,
  ripHistory: ['rip', 'history'] as const,
  ripSession: (id: number) => ['rip', 'session', id] as const,
  ripPackWrappers: (key: string) => ['rip', 'packWrappers', key] as const,
  setsList: ['sets', 'list'] as const,
  setChecklist: (name: string, language: Language) =>
    ['sets', 'checklist', language, name] as const,
  search: (q: string) => ['search', q] as const,
  card: (id: number) => ['card', id] as const,
  forCard: (id: number) => ['forCard', id] as const,
  update: ['update'] as const,
  account: ['account'] as const,
  browse: (f: Omit<BrowseFilters, 'offset' | 'limit'>) => ['browse', f] as const,
  browseFacets: ['browse', 'facets'] as const,
  friends: ['friends'] as const,
  friendEntries: (id: number, f: CollectionFilters) => ['friends', id, 'entries', f] as const,
  friendFacets: (id: number) => ['friends', id, 'facets'] as const
}

/** Query-key prefixes to invalidate after any collection mutation. */
export const mutationInvalidationKeys = [
  ['entries'],
  ['facets'],
  ['stats'],
  ['forCard'],
  ['sets'],
  ['browse']
] as const
