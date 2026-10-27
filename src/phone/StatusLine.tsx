import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { STORAGE_WARNING, cardDataAge } from './copy'
import { CATALOG_KEY, SYNC_STATE_KEY, usePhone } from './context'
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
 * One line on how the collection stands with the server: offline, syncing, waiting, all synced, or
 * entries it can't take (which opens their list), plus the card data's date. While adds wait and
 * the browser hasn't promised to keep the data, it warns that the data may be cleared.
 */
export function StatusLine({ className }: { className?: string }): React.JSX.Element {
  const { store } = usePhone()
  const qc = useQueryClient()
  const online = useOnline()
  const persisted = usePersisted()
  const [syncing, setSyncing] = useState(false)
  const [problemsOpen, setProblemsOpen] = useState(false)

  const sync = useQuery({
    queryKey: SYNC_STATE_KEY,
    queryFn: () => store.syncState(),
    refetchInterval: POLL_MS
  })
  const catalog = useQuery({ queryKey: CATALOG_KEY, queryFn: () => store.catalog() })

  useEffect(
    () =>
      api.account.onChange((s) => {
        setSyncing(s.state === 'syncing')
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
    : syncing
      ? 'Syncing…'
      : waiting > 0
        ? `${waiting} waiting to sync`
        : problems === 0
          ? 'All synced'
          : null
  const dot = !online ? 'bg-amber-400' : syncing || waiting > 0 ? 'bg-sky-400' : 'bg-emerald-400'
  const age = cardDataAge(catalog.data?.lastSyncAt ?? null)

  return (
    <div className={cn('px-4 py-2 text-[13px] text-muted-foreground', className)}>
      <div className="flex min-h-6 items-center gap-2">
        {sync.data && (
          <>
            {text && (
              <>
                <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dot)} />
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
          </>
        )}
        {age && <span className="ml-auto shrink-0 tabular-nums">{age}</span>}
      </div>
      {persisted === false && waiting > 0 && (
        <p className="mt-1 text-xs text-amber-200/80">{STORAGE_WARNING}</p>
      )}
      <SyncProblems open={problemsOpen} onOpenChange={setProblemsOpen} />
    </div>
  )
}
