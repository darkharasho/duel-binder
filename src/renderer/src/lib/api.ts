import type { QueryClient } from '@tanstack/react-query'
import type { GameId } from '@shared/games'
import type { Api } from '@shared/ipc'
import type { Language } from '@shared/languages'
import type { BrowseFilters, CollectionFilters } from '@shared/types'
import { isWeb } from './platform'

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
  friendFacets: (id: number) => ['friends', id, 'facets'] as const,
  friendsWithCard: (game: GameId, cardId: number) => ['friends', 'card', game, cardId] as const
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

/**
 * Invalidates `mutationInvalidationKeys` (bar those `skip` takes) after a write here. Pages keep their
 * data once left, so on desktop, where a read is cheap, pages off screen refetch now as well: the
 * next one opened shows the change at once, not its old rows.
 */
export function invalidateAfterEdit(
  qc: QueryClient,
  skip: (key: readonly string[]) => boolean = () => false
): Promise<unknown> {
  const refetchType = isWeb() ? 'active' : 'all'
  return Promise.all(
    mutationInvalidationKeys
      .filter((k) => !skip(k))
      .map((k) => qc.invalidateQueries({ queryKey: [...k], refetchType }))
  )
}
