import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { mutationInvalidationKeys } from '@/lib/api'
import { GAMES, type GameId } from '@shared/games'
import type { CatalogStatus } from './data/store'
import { usePhone } from './context'

export const CATALOG_STATUS_KEY = ['phone', 'catalogStatus'] as const

/** How often the status is asked for while a game's card data is still coming down. */
const POLL_MS = 1_500

/** "Downloading Magic cards… 62%" for the status line; null when nothing is downloading. */
export function downloadText(status: CatalogStatus | undefined): string | null {
  const d = status?.downloading
  if (!d) return null
  const name = GAMES[d.game].name
  return d.percent === null
    ? `Downloading ${name} cards…`
    : `Downloading ${name} cards… ${d.percent}%`
}

/**
 * The background card data download's state (see PhoneStore.updateCatalog), asked again every
 * moment while any game is still missing.
 */
export function useCatalogStatus(): CatalogStatus | undefined {
  const { store } = usePhone()
  return useQuery({
    queryKey: CATALOG_STATUS_KEY,
    queryFn: () => store.catalogStatus(),
    refetchInterval: (q) => {
      const s = q.state.data
      return s && s.missing.length === 0 && !s.downloading ? false : POLL_MS
    }
  }).data
}

/**
 * Reloads the pages each time a game's card data finishes coming down: its cards, and the
 * collection entries waiting on them, show now. Once, in the app shell.
 */
export function useReloadAsGamesLand(): void {
  const qc = useQueryClient()
  const missing = useCatalogStatus()?.missing.join(',')
  const before = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (missing === undefined) return
    const was = before.current
    before.current = missing
    if (was === undefined || was === missing) return
    for (const queryKey of mutationInvalidationKeys) void qc.invalidateQueries({ queryKey })
    void qc.invalidateQueries({ queryKey: ['card'] })
  }, [missing, qc])
}

/** Whether this game's card data is still coming down (unknown counts as no). */
export function useGameDownloading(game: GameId): boolean {
  return useCatalogStatus()?.missing.includes(game) ?? false
}
