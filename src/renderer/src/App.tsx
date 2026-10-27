import { Suspense, lazy, useEffect } from 'react'
import { AppShell } from '@/components/AppShell'
import { PageSwitch, PagesAddCard, usePages } from '@/components/pageSwitch'
import { Toaster } from '@/components/ui/sonner'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { isWeb } from '@/lib/platform'
import { useAccountState } from '@/lib/account'
import { SignInScreen } from '@/features/account/SignInScreen'
import { TitleBar } from '@/components/TitleBar'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import { useUpdateToasts } from '@/features/settings/useUpdateToasts'

// Loaded on demand, so the web build (which has no Scan) never pulls in the vision worker.
const RipPage = lazy(() => import('@/features/rip/RipPage').then((m) => ({ default: m.RipPage })))
const ScanPage = lazy(() =>
  import('@/features/scan/ScanPage').then((m) => ({ default: m.ScanPage }))
)

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
  const pages = usePages('dashboard')
  const { page, onNavigate, openAdd } = pages

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
        <PageSwitch
          pages={pages}
          scan={
            !isWeb() && (
              <Suspense fallback={null}>
                <ScanPage />
              </Suspense>
            )
          }
          rip={
            !isWeb() && (
              <Suspense fallback={null}>
                <RipPage />
              </Suspense>
            )
          }
          settings={<SettingsPage />}
        />
      </AppShell>
      <PagesAddCard pages={pages} />
      <Toaster />
    </>
  )
}

export default App
