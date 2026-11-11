import { useQuery } from '@tanstack/react-query'
import { gameOfId } from '@shared/games'
import { isReverseFinish, printingReverseLook, type ReverseLook } from '@shared/reverseHolo'
import { api, queryKeys } from '@/lib/api'

/**
 * A printing's reverse look where the surface knows only its finish and set code: the card's
 * category and types (the pattern's symbol) come from the card, fetched only for a Pokémon reverse
 * and shared with the card panel's query. Null until then, and for every other printing.
 */
export function useReverseLook(
  card: { cardId: number; imageId: number },
  finish: string | null | undefined,
  setCode: string | null | undefined
): ReverseLook | null {
  const wanted = !!setCode && isReverseFinish(finish) && gameOfId(card.imageId) === 'pkm'
  const detail = useQuery({
    queryKey: queryKeys.card(card.cardId),
    queryFn: () => api.cards.get(card.cardId),
    enabled: wanted
  })
  if (!wanted || !detail.data) return null
  return printingReverseLook({ setRarity: finish ?? '', setCode: setCode ?? '' }, detail.data.card)
}
