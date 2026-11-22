import { useQuery } from '@tanstack/react-query'
import type { GameId } from '@shared/games'
import type { PackState } from '@shared/decks/pack'
import { PACK_REFRESH_MS } from '@shared/decks/rulesCache'
import { api, queryKeys } from '@/lib/api'

/** The game's rules pack; undefined until the first read lands. Asked again after 24 h. */
export function useRulesPack(game: GameId): PackState | undefined {
  const q = useQuery({
    queryKey: queryKeys.rulesPack(game),
    queryFn: () => api.decks.rules(game),
    staleTime: PACK_REFRESH_MS
  })
  // A failed read is no pack: the badge says so rather than going missing.
  return q.isError ? { state: 'missing' } : q.data
}

/** Today's date where the user is, YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
