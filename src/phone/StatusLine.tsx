import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
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

/**
 * One line when the collection isn't in step with the server: offline, adds waiting, or entries it
 * can't take (which opens their list). Nothing shows when all is synced.
 */
export function StatusLine({ className }: { className?: string }): React.JSX.Element | null {
  const { store } = usePhone()
  const qc = useQueryClient()
  const online = useOnline()
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
      <SyncProblems open={problemsOpen} onOpenChange={setProblemsOpen} />
    </div>
  )
}
