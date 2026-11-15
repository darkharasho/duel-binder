import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { parsePrefs, type Prefs } from '@shared/prefs'
import { api, queryKeys } from './api'
import { useFriendsReady } from './friends'

const KEY = 'prefs:v1'

/** Window-wide copy of the prefs. Null until first read, so startup reads storage with no wait. */
let cache: Prefs | null = null
/** Newest query result already applied, window-wide: "new data" means new to the window, not to one instance. */
let seenUpdatedAt = 0
const listeners = new Set<() => void>()

function readStorage(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    return parsePrefs(raw === null ? null : JSON.parse(raw))
  } catch {
    return parsePrefs(null)
  }
}

function writeStorage(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // private mode or quota: the in-memory value still applies
  }
}

const notify = (): void => listeners.forEach((l) => l())

function getSnapshot(): Prefs {
  if (!cache) cache = readStorage()
  return cache
}

/** Take a new value: memory, storage and every subscriber. Skips the work when nothing changed. */
function commit(next: Prefs): void {
  const clean = parsePrefs(next)
  if (JSON.stringify(clean) === JSON.stringify(getSnapshot())) return
  cache = clean
  writeStorage(clean)
  notify()
}

function onStorage(e: StorageEvent): void {
  if (e.key !== KEY && e.key !== null) return
  cache = readStorage()
  notify()
}

function subscribe(cb: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

/** Test-only: forget the in-memory copy so the next read goes back to storage. */
export function resetWashStoreForTests(): void {
  cache = null
  seenUpdatedAt = 0
}

let setSeq = 0

export function useWashPref(): { wash: Prefs['wash']; setWash: (next: Prefs['wash']) => void } {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const ready = useFriendsReady()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.prefs,
    queryFn: async () => parsePrefs(await api.prefs.get()),
    enabled: ready,
    refetchOnWindowFocus: true,
    refetchInterval: 300_000,
    retry: false
  })

  // A query result becomes the value only when it is new, so a stale cached one can't undo a local change.
  useEffect(() => {
    if (!query.data || query.dataUpdatedAt <= seenUpdatedAt) return
    seenUpdatedAt = query.dataUpdatedAt
    commit(query.data)
  }, [query.data, query.dataUpdatedAt])

  const setWash = useCallback(
    (next: Prefs['wash']) => {
      const value: Prefs = { wash: next }
      commit(value)
      // Keep the cached result in step so a later mount can't replay an older one over this choice.
      queryClient.setQueryData(queryKeys.prefs, parsePrefs(value))
      seenUpdatedAt = Math.max(seenUpdatedAt, queryClient.getQueryState(queryKeys.prefs)?.dataUpdatedAt ?? 0)
      if (!ready) return
      const mine = ++setSeq
      void queryClient.cancelQueries({ queryKey: queryKeys.prefs })
      api.prefs
        .set({ wash: next })
        .then((saved) => {
          if (mine === setSeq) queryClient.setQueryData(queryKeys.prefs, parsePrefs(saved))
        })
        .catch(() => {
          // offline or signed out of the portal: the local value stays
        })
    },
    [ready, queryClient]
  )

  return { wash: prefs.wash, setWash }
}
