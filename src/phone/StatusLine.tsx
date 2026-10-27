import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { STORAGE_WARNING } from './copy'
import { SYNC_STATE_KEY, usePhone } from './context'
import { SyncProblems } from './SyncProblems'

const POLL_MS = 5_000

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = (): void => setOnline(true)
    const off = (): void => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** Whether the browser has promised to keep this app's data; null while asking or unknown. */
function usePersisted(): boolean | null {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    navigator.storage
      ?.persisted?.()
      .then((p) => {
        if (live) setPersisted(p)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return persisted
}

/**
 * One line when the collection isn't in step with the server: offline, adds waiting, or entries it
 * can't take (which opens their list). Nothing shows when all is synced. While adds wait and the
 * browser hasn't promised to keep the data, it warns that the data may be cleared.
 */
export function StatusLine({ className }: { className?: string }): React.JSX.Element | null {
  const { store } = usePhone()
  const qc = useQueryClient()
  const online = useOnline()
  const persisted = usePersisted()
  const [problemsOpen, setProblemsOpen] = useState(false)

  const sync = useQuery({
    queryKey: SYNC_STATE_KEY,
    queryFn: () => store.syncState(),
    refetchInterval: POLL_MS
  })

  useEffect(
    () =>
      api.account.onChange((s) => {
        // After each sync, not only on the next poll.
        if (s.state !== 'syncing') void qc.invalidateQueries({ queryKey: SYNC_STATE_KEY })
      }),
    [qc]
  )

  const waiting = sync.data?.waiting ?? 0
  const problems = sync.data?.problems ?? 0
  const text = !online
    ? waiting > 0
      ? `Offline · ${waiting} waiting to sync`
      : 'Offline'
    : waiting > 0
      ? `${waiting} waiting to sync`
      : null
  if (!sync.data || (!text && problems === 0)) return null

  return (
    <div className={cn('px-4 py-2 text-[13px] text-muted-foreground', className)}>
      <div className="flex min-h-6 items-center gap-2">
        {text && (
          <>
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                online ? 'bg-sky-400' : 'bg-amber-400'
              )}
            />
            <span role="status">{text}</span>
          </>
        )}
        {problems > 0 && (
          <button
            type="button"
            onClick={() => setProblemsOpen(true)}
            className="-my-2 rounded-md px-1 py-2 font-medium text-amber-300 underline-offset-2 active:underline"
          >
            {problems} can&apos;t sync
          </button>
        )}
      </div>
      {persisted === false && waiting > 0 && (
        <p className="mt-1 text-xs text-amber-200/80">{STORAGE_WARNING}</p>
      )}
      <SyncProblems open={problemsOpen} onOpenChange={setProblemsOpen} />
    </div>
  )
}
