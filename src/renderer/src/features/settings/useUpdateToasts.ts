import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { UpdateStatus } from '@shared/types'
import { api, queryKeys } from '@/lib/api'

const TOAST_ID = 'app-update'

/**
 * Keeps the shared update-status query current (seeded from main on mount, then
 * pushed events) and shows a single, non-stacking toast for it.
 */
export function useUpdateToasts(): void {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: queryKeys.update, queryFn: () => api.app.updateStatus() })

  useEffect(() => {
    return api.app.onUpdateStatus((s: UpdateStatus) => qc.setQueryData(queryKeys.update, s))
  }, [qc])

  const state = data?.state
  const mode = data?.mode
  const version = data?.version
  useEffect(() => {
    if (state === 'ready') {
      toast(`Update ${version} ready`, {
        id: TOAST_ID,
        duration: Infinity,
        action: { label: 'Restart now', onClick: () => void api.app.applyUpdate() },
        cancel: { label: 'Later', onClick: () => undefined }
      })
    } else if (state === 'available' && mode === 'notify') {
      toast(`Update ${version} available`, {
        id: TOAST_ID,
        duration: Infinity,
        action: { label: 'Download', onClick: () => void api.app.applyUpdate() }
      })
    }
  }, [state, mode, version])
}

export function useUpdateStatus(): UpdateStatus | undefined {
  return useQuery({ queryKey: queryKeys.update, queryFn: () => api.app.updateStatus() }).data
}
