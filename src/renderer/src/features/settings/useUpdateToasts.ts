import { useEffect } from 'react'
import { toast } from 'sonner'
import type { UpdateStatus } from '@shared/types'
import { api } from '@/lib/api'

const TOAST_ID = 'app-update'

/** Subscribes to update status once and shows a single, non-stacking toast. */
export function useUpdateToasts(): void {
  useEffect(() => {
    return api.app.onUpdateStatus((s: UpdateStatus) => {
      if (s.state === 'ready') {
        toast(`Update ${s.version} ready`, {
          id: TOAST_ID,
          duration: Infinity,
          action: { label: 'Restart now', onClick: () => void api.app.applyUpdate() },
          cancel: { label: 'Later', onClick: () => undefined }
        })
      } else if (s.state === 'available' && s.mode === 'notify') {
        toast(`Update ${s.version} available`, {
          id: TOAST_ID,
          duration: Infinity,
          action: { label: 'Download', onClick: () => void api.app.applyUpdate() }
        })
      }
    })
  }, [])
}
