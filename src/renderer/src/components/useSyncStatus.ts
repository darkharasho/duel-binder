import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SyncStatus } from '@shared/types'
import { api, queryKeys } from '@/lib/api'

const BUSY: SyncStatus['state'][] = ['checking', 'downloading', 'saving']
export const isSyncing = (s: SyncStatus | undefined): boolean => !!s && BUSY.includes(s.state)

export function useSyncStatus(): SyncStatus | undefined {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: queryKeys.sync, queryFn: () => api.sync.status() })

  useEffect(() => {
    return api.sync.onProgress((next) => {
      const prev = qc.getQueryData<SyncStatus>(queryKeys.sync)
      qc.setQueryData(queryKeys.sync, next)
      // Card data (and prices) changed: refresh everything derived from it.
      if (prev && isSyncing(prev) && !isSyncing(next) && next.state !== 'error') {
        for (const key of ['entries', 'facets', 'stats', 'forCard', 'search', 'card']) {
          void qc.invalidateQueries({ queryKey: [key] })
        }
      }
    })
  }, [qc])

  return query.data
}
