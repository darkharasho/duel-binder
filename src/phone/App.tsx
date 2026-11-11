import { useCallback, useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { isNativeApp } from '@/lib/portal'
import type { EngineFactory } from '@/features/scan/engine'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import type { Me } from '../shared/cloud'
import { OPEN_ELSEWHERE, UNSUPPORTED } from './copy'
import { PhoneContext, type PhoneSession } from './context'
import { DB_OPEN_ELSEWHERE } from './data/openRetry'
import type { PhoneStore } from './data/store'
import { PhoneScreen } from './PhoneScreen'
import { PhoneShell } from './PhoneShell'
import { claimSavedScans } from './savedScans'
import { SignIn } from './SignIn'
import { exitStream } from './stream/device'

type View =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'open-elsewhere' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; user: Me }

/** The screen for the data worker's fatal message: another tab holds the database, or it can't run. */
const fatalView = (message: string): View =>
  message === DB_OPEN_ELSEWHERE ? { kind: 'open-elsewhere' } : { kind: 'unsupported' }
const isFatal = (v: View): boolean => v.kind === 'unsupported' || v.kind === 'open-elsewhere'

/** The bottom navigation is 4rem plus the safe area, and the Scan button rises above it. */
const TOAST_OFFSET = { bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }

/**
 * The phone app: loading, then a fatal screen (the data worker can't run here, or another tab has
 * the app's data open), sign-in,
 * first run (the card data download) or the app itself. `onFatal` reports the data worker's
 * failure (see createPhoneRuntime). `engineFactory` is for tests; the scanner uses the real one.
 */
export function App({
  store,
  onFatal,
  engineFactory
}: {
  store: PhoneStore
  onFatal: (cb: (message: string) => void) => () => void
  engineFactory?: EngineFactory
}): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } }
      })
  )

  // The app has one dark theme; `dark` keeps shadcn's dark: variants in step with it.
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  // A reloaded page can't know the app was left sideways and awake by a stream, so it starts upright.
  useEffect(() => {
    if (isNativeApp()) void exitStream()
  }, [])

  // A fatal wins over every other view, whenever it comes.
  useEffect(() => onFatal((message) => setView(fatalView(message))), [onFatal])
  const show = useCallback((next: View) => setView((v) => (isFatal(v) ? v : next)), [])

  /**
   * Where a signed-in user goes: straight into the app. Card data still missing comes down in the
   * background (see useReadyChecks), and the status line says so.
   */
  const enter = useCallback(
    async (user: Me): Promise<void> => {
      claimSavedScans(user.id)
      show({ kind: 'ready', user })
    },
    [show]
  )

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const account = await store.account()
        if (!live) return
        if (account.state === 'signed-in') await enter(account.user)
        else show({ kind: 'signed-out' })
      } catch (e) {
        // The store can't read its own database: the worker's fatal says why.
        if (live)
          setView((v) => (isFatal(v) ? v : fatalView((e as Error | undefined)?.message ?? '')))
      }
    })()
    return () => {
      live = false
    }
  }, [store, enter, show])

  const signedOut = useCallback((): void => {
    // The next account must not see this one's pages.
    client.clear()
    show({ kind: 'signed-out' })
  }, [client, show])

  // The server can end the session (a revoked token): back to sign-in, which keeps every row.
  const ready = view.kind === 'ready'
  useEffect(() => {
    if (!ready) return
    return window.api.account.onChange((s) => {
      if (s.state === 'signed-out') signedOut()
      else if (s.user) {
        // A changed username or dismissed hint: the screens read it from the session.
        const next = s.user
        setView((v) =>
          v.kind === 'ready' && JSON.stringify(v.user) !== JSON.stringify(next)
            ? { ...v, user: next }
            : v
        )
      }
    })
  }, [ready, signedOut])

  const user = view.kind === 'ready' ? view.user : null
  const session = useMemo<PhoneSession | null>(
    () => (user ? { store, user, signedOut } : null),
    [store, user, signedOut]
  )

  let screen: React.JSX.Element
  switch (view.kind) {
    case 'loading':
      screen = (
        <PhoneScreen>
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        </PhoneScreen>
      )
      break
    case 'unsupported':
      screen = (
        <PhoneScreen>
          <p role="alert" className="max-w-sm text-base">
            {UNSUPPORTED}
          </p>
        </PhoneScreen>
      )
      break
    case 'open-elsewhere':
      screen = (
        <PhoneScreen>
          <p role="alert" className="max-w-sm text-base">
            {OPEN_ELSEWHERE}
          </p>
        </PhoneScreen>
      )
      break
    case 'signed-out':
      screen = (
        <SignIn
          store={store}
          onSignedIn={(u) => {
            void enter(u).catch(() => show({ kind: 'unsupported' }))
          }}
        />
      )
      break
    case 'ready':
      screen = (
        <PhoneContext.Provider value={session}>
          <ScanHubProvider>
            <PhoneShell engineFactory={engineFactory} />
          </ScanHubProvider>
        </PhoneContext.Provider>
      )
      break
  }

  return (
    <QueryClientProvider client={client}>
      {screen}
      {/* Above the bottom navigation and its raised Scan button, so a toast never covers a tab. */}
      <Toaster offset={TOAST_OFFSET} mobileOffset={TOAST_OFFSET} />
    </QueryClientProvider>
  )
}
