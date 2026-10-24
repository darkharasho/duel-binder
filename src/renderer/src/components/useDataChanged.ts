import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, mutationInvalidationKeys } from '@/lib/api'

/** Background syncs in main change set and card data; refetch everything derived from it. */
export function useDataChanged(): void {
  const qc = useQueryClient()
  useEffect(() => {
    return api.app.onDataChanged(() => {
      for (const queryKey of mutationInvalidationKeys) void qc.invalidateQueries({ queryKey })
      // Card details (printings) change with sync; mutations don't need this, so it's not shared.
      void qc.invalidateQueries({ queryKey: ['card'] })
    })
  }, [qc])
}
