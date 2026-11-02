import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type Query } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, queryKeys } from './api'

/** A collection or Browse list filtered to favourites: the only lists a heart can change. */
const filteredToFavourites = (q: Query): boolean =>
  (q.queryKey[0] === 'entries' || q.queryKey[0] === 'browse') &&
  (q.queryKey[1] as { favourites?: unknown } | undefined)?.favourites === true

export interface Favourites {
  isFavourite(cardId: number): boolean
  /** Hearts a card (`on`) or takes the heart off it; the heart changes at once. */
  toggle(cardId: number, on: boolean): void
}

/**
 * The cards this account hearted, in the game shown. A toggle shows at once and is undone, with a
 * toast, if the write fails; a list filtered to favourites then reloads. Not `enabled` (a friend's
 * page), nothing is asked for.
 */
export function useFavourites(enabled = true): Favourites {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: queryKeys.favourites,
    queryFn: () => api.favourites.list(),
    enabled
  })
  const ids = useMemo(() => new Set(data ?? []), [data])
  const { mutate } = useMutation<void, Error, { cardId: number; on: boolean }, () => void>({
    mutationFn: ({ cardId, on }) => api.favourites.set(cardId, on),
    onMutate: async ({ cardId, on }) => {
      await qc.cancelQueries({ queryKey: queryKeys.favourites })
      const before = qc.getQueryData<number[]>(queryKeys.favourites)
      const others = (before ?? []).filter((id) => id !== cardId)
      qc.setQueryData<number[]>(queryKeys.favourites, on ? [...others, cardId] : others)
      return () => qc.setQueryData(queryKeys.favourites, before)
    },
    onError: (_e, _vars, undo) => {
      undo?.()
      toast.error('Could not update your favourites')
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.favourites }),
        qc.invalidateQueries({ predicate: filteredToFavourites })
      ])
  })
  return useMemo(
    () => ({
      isFavourite: (cardId) => ids.has(cardId),
      toggle: (cardId, on) => mutate({ cardId, on })
    }),
    [ids, mutate]
  )
}
