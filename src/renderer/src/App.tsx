import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import type { CardSearchResult } from '@shared/types'
import { AppShell, type NavigateFn, type Page } from '@/components/AppShell'
import { Toaster } from '@/components/ui/sonner'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { SetsPage } from '@/features/sets/SetsPage'
import { FriendsPage } from '@/features/friends/FriendsPage'
import { useFriendsAvailable } from '@/lib/friends'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { useDataChanged } from '@/components/useDataChanged'
import { isWeb } from '@/lib/platform'
import { useAccountState } from '@/lib/account'
import { SignInScreen } from '@/features/account/SignInScreen'
import { TitleBar } from '@/components/TitleBar'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import { useUpdateToasts } from '@/features/settings/useUpdateToasts'

// Loaded on demand, so the web build (which has no Scan) never pulls in the vision worker.
const ScanPage = lazy(() =>
  import('@/features/scan/ScanPage').then((m) => ({ default: m.ScanPage }))
)

interface AddInitial {
  card: CardSearchResult
  printingId: number
}

/** Hooks that only make sense in the desktop app; kept in a component so the web build can skip them. */
function DesktopOnlyEffects(): null {
  useUpdateToasts()
  return null
}

function Gate(): React.JSX.Element {
  const web = isWeb()
  const { status: account, failed } = useAccountState()
  if (!web) {
    // Until the first status arrives show neither the gate nor the app, so neither flashes.
    if (!account && failed) return <SignInScreen />
    if (!account) {
      return (
        <div className="flex h-screen flex-col bg-background">
          <TitleBar />
        </div>
      )
    }
    if (
      account.signInRequired &&
      (account.state === 'signed-out' || account.state === 'signing-in')
    ) {
      return <SignInScreen status={account} />
    }
  }
  return <SignedInApp />
}

/** On desktop the hub sits above the sign-in gate, so it outlives every page and sign-in state. */
function App(): React.JSX.Element {
  return isWeb() ? (
    <Gate />
  ) : (
    <ScanHubProvider>
      <Gate />
    </ScanHubProvider>
  )
}

function SignedInApp(): React.JSX.Element {
  const [chosenPage, setPage] = useState<Page>('dashboard')
  const [entryId, setEntryId] = useState<number | undefined>()
  const [friendsKey, setFriendsKey] = useState(0)
  const friendsAvailable = useFriendsAvailable()
  // Desktop sign-out takes the Friends nav item away; don't leave its page showing.
  const page: Page = chosenPage === 'friends' && !friendsAvailable ? 'dashboard' : chosenPage
  const [addOpen, setAddOpen] = useState(false)
  const [addInitial, setAddInitial] = useState<AddInitial | null>(null)
  useDataChanged()

  const openAdd = useCallback((initial: AddInitial | null = null): void => {
    setAddInitial(initial)
    setAddOpen(true)
  }, [])

  const onNavigate: NavigateFn = useCallback((next, opts) => {
    setEntryId(opts?.entryId)
    if (next === 'friends') setFriendsKey((k) => k + 1)
    setPage(next)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openAdd()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openAdd])

  return (
    <>
      {!isWeb() && <DesktopOnlyEffects />}
      <AppShell page={page} onNavigate={onNavigate} onAddCard={() => openAdd()}>
        {page === 'dashboard' && (
          <DashboardPage onNavigate={onNavigate} onAddCard={() => openAdd()} />
        )}
        {page === 'collection' && (
          <CollectionPage
            key={entryId ?? 'all'}
            initialEntryId={entryId}
            onAddCard={() => openAdd()}
          />
        )}
        {page === 'browse' && (
          <BrowsePage onAddCard={(card, printingId) => openAdd({ card, printingId })} />
        )}
        {page === 'sets' && (
          <SetsPage
            onAddCard={() => openAdd()}
            onAddMissing={(card, printingId) => openAdd({ card, printingId })}
          />
        )}
        {page === 'scan' && !isWeb() && (
          <Suspense fallback={null}>
            <ScanPage />
          </Suspense>
        )}
        {page === 'friends' && (
          <FriendsPage key={friendsKey} onBackToMine={() => onNavigate('collection')} />
        )}
        {page === 'settings' && <SettingsPage />}
      </AppShell>
      <AddCardDialog open={addOpen} onOpenChange={setAddOpen} initial={addInitial} />
      <Toaster />
    </>
  )
}

export default App
