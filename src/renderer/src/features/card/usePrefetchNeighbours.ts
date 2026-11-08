import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, queryKeys } from '@/lib/api'

/**
 * Loads the details of the cards either side of the open one, so a step shows the next card at
 * once instead of an empty panel while they load.
 */
export function usePrefetchNeighbours(prev: number | undefined, next: number | undefined): void {
  const qc = useQueryClient()
  useEffect(() => {
    for (const id of [prev, next]) {
      if (id === undefined) continue
      void qc.prefetchQuery({ queryKey: queryKeys.card(id), queryFn: () => api.cards.get(id) })
      void qc.prefetchQuery({
        queryKey: queryKeys.forCard(id),
        queryFn: () => api.collection.forCard(id)
      })
    }
  }, [qc, prev, next])
}
