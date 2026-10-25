import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { isWeb } from '@/lib/platform'
import { isSyncing, useSyncStatus } from './useSyncStatus'

export function SyncBanner(): React.JSX.Element | null {
  const status = useSyncStatus()
  const qc = useQueryClient()
  if (!status || isWeb()) return null

  const retry = (): void => {
    // Failures are surfaced through the sync status (onProgress); just log here.
    void api.sync
      .run()
      .then((s) => qc.setQueryData(queryKeys.sync, s))
      .catch((e) => console.error('Sync retry failed', e))
  }

  let message: string
  let showRetry = true
  if (isSyncing(status)) {
    message = 'Downloading card database…'
    showRetry = false
  } else if (status.state === 'error') {
    message =
      status.cardCount > 0
        ? `Offline — using saved card data (prices updated ${formatRelative(status.lastSyncAt)})`
        : 'No card data yet. Connect to the internet and download the card database to get started.'
  } else if (status.cardCount === 0) {
    message = 'No card data yet. Connect to the internet and download the card database to get started.'
  } else {
    return null
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b bg-muted px-6 py-2.5 text-sm text-muted-foreground"
    >
      {!showRetry && <Loader2 className="size-4 animate-spin" aria-hidden />}
      <span className="flex-1">{message}</span>
      {showRetry && (
        <Button size="sm" variant="outline" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  )
}
