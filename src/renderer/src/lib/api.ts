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
  friendStats: (id: number) => ['friends', id, 'stats'] as const,
  friendSets: (id: number) => ['friends', id, 'sets'] as const,
  friendChecklist: (id: number, name: string, language: Language) =>
    ['friends', id, 'checklist', name, language] as const,
  friendsWithCard: (game: GameId, cardId: number) => ['friends', 'card', game, cardId] as const,
  friendWishlist: (id: number) => ['friends', id, 'wishlist'] as const,
  friendsWanting: (game: GameId, cardId: number) => ['friends', 'wanting', game, cardId] as const,
  friendsOwning: (game: GameId, pkeys: string[]) => ['friends', 'owning', game, pkeys] as const,
  wishlistVisible: ['friends', 'wishlistVisible'] as const,
  wishlist: ['wishlist'] as const,
  wishlistForCard: (id: number) => ['wishlist', 'card', id] as const,
  binders: ['binders'] as const,
  binder: (uid: string) => ['binders', 'binder', uid] as const,
  bindersForCard: (id: number) => ['binders', 'card', id] as const
}

/** Query-key prefixes to invalidate after any collection mutation. */
export const mutationInvalidationKeys = [
  ['entries'],
  ['facets'],
  ['stats'],
  ['forCard'],
  ['sets'],
  ['browse'],
  ['wishlist'],
  ['binders']
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
