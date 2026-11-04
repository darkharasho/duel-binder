import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { HitPriceInput } from '@/features/scan/HitPriceInput'
import { useScanHub } from '@/features/scan/ScanHub'
import { DeleteAccount } from '@/features/settings/AccountSection'
import { SignInMethods } from '@/features/settings/SignInMethods'
import { EbayPricesToggle } from '@/features/settings/EbayPricesToggle'
import { ScanPingToggle } from '@/features/settings/ScanPingToggle'
import { UsageToggle } from '@/features/settings/UsageToggle'
import { WishlistToggle } from '@/features/settings/WishlistToggle'
import { toast } from 'sonner'
import type { CardChoice, MergePreview, SignInProvider } from '@shared/account'
import { MergeDialog } from '@/features/account/MergeDialog'
import { api } from '@/lib/api'
import { useGame } from '@/lib/game'
import { APP_PLATFORM, isNativeApp } from '@/lib/portal'
import { GAMES, type GameId } from '@shared/games'
import { PRIVACY_URL, SIGN_OUT_FAILED, cardDataAge, signOutWarning } from './copy'
import { CATALOG_KEY, SYNC_STATE_KEY, displayName, usePhone } from './context'
import { SYNC_FIRST, linkableProviders, linkSignIn, syncedFirst } from './linking'
import { forgetSavedScans } from './savedScans'
import { refreshAllFingerprints } from './refreshFingerprints'
import { ScreenDetails } from './ScreenDetails'
import { SyncProblems } from './SyncProblems'

/** Ends the web session too, so the cookie doesn't sign the phone straight back in. */
async function webLogout(): Promise<void> {
  // The iOS app never had a web session.
  if (isNativeApp()) return
  try {
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }
    })
  } catch {
    // Offline: the cookie stays until it expires; the phone's own token is gone either way.
  }
}

const REFRESH_FAILED = {
  cards: "Couldn't refresh the card data. Try again later.",
  artwork: "Couldn't refresh the artwork data. Try again later."
}

type Refresh =
  | { state: 'idle' }
  | { state: 'running'; step: string }
  | { state: 'done' }
  | { state: 'error'; message: string }

function Group({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.06] bg-card">
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex min-h-12 items-center gap-3 px-4 py-2 text-[15px]">{children}</div>
}

const rowButton =
  'flex min-h-12 w-full items-center px-4 py-2 text-left text-[15px] active:bg-white/[0.06] disabled:opacity-50'

/**
 * The phone's Settings: the account, card data, sync problems, privacy, the stream's hit price and
 * the app's version. With `onContribute`, a tester (of a game open to testers only) also gets
 * Contribute photos, which opens that game's training photo screen.
 */
export function Settings({
  onContribute
}: {
  onContribute?: (game: GameId) => void
} = {}): React.JSX.Element {
  const { store, user, signedOut } = usePhone()
  const { available } = useGame()
  const testerGame = available.find((g) => GAMES[g].access === 'testers')
  const { settings, setSettings } = useScanHub()
  const qc = useQueryClient()
  const name = displayName(user)
  const [warnWaiting, setWarnWaiting] = useState<number | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const methods = useQuery({
    queryKey: ['account', 'signIns'],
    queryFn: () => api.account.signIns()
  })
  const [linking, setLinking] = useState(false)
  const [merge, setMerge] = useState<{ ticket: string; preview: MergePreview } | null>(null)
  const linkable = methods.data ? linkableProviders(APP_PLATFORM, methods.data) : []
  const refreshMethods = (): Promise<void> =>
    qc.invalidateQueries({ queryKey: ['account', 'signIns'] })
  const syncFirst = (): Promise<boolean> =>
    syncedFirst({ syncNow: () => api.account.syncNow(), syncState: () => store.syncState() })
  const link = async (provider: SignInProvider): Promise<void> => {
    if (linking) return
    setLinking(true)
    const label = provider === 'apple' ? 'Apple' : 'Discord'
    try {
      if (!(await syncFirst())) {
        toast.error(SYNC_FIRST)
        return
      }
      const out = await linkSignIn(provider, { store })
      if (!out) return
      if (out.status === 'linked') {
        toast.success(`${label} linked`)
        await refreshMethods()
      } else if (out.status === 'already') {
        toast.success(`That ${label} account is already linked here`)
      } else if (out.status === 'has-provider') {
        toast.error(`This account already has a ${label} sign-in, so that one can't be added`)
      } else {
        setMerge({ ticket: out.ticket, preview: out.preview })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Couldn't link ${label}`)
    } finally {
      setLinking(false)
    }
  }
  const doMerge = async (choice: {
    cards: CardChoice
    username: 'mine' | 'theirs'
  }): Promise<void> => {
    if (!merge) return
    // The merge screen shows the refusal and lets the person try again.
    if (!(await syncFirst())) throw new Error(SYNC_FIRST)
    // Stores the returned account (api.account.merge), then pulls the merged cards.
    await api.account.merge(merge.ticket, choice)
    setMerge(null)
    await refreshMethods()
    await api.account.syncNow().catch(() => undefined)
  }
  const [signOutFailed, setSignOutFailed] = useState(false)
  const [refresh, setRefresh] = useState<Refresh>({ state: 'idle' })
  const [problemsOpen, setProblemsOpen] = useState(false)

  const sync = useQuery({ queryKey: SYNC_STATE_KEY, queryFn: () => store.syncState() })
  const catalog = useQuery({ queryKey: CATALOG_KEY, queryFn: () => store.catalog() })
  const version = useQuery({ queryKey: ['phone', 'version'], queryFn: () => api.app.version() })

  const signOut = async (): Promise<void> => {
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      // The cookie goes first: the sign-in screen would otherwise trade it straight back.
      await webLogout()
      await api.account.signOut()
      signedOut()
    } catch {
      // The app's data stopped answering: say so rather than fail silently.
      setSignOutFailed(true)
    } finally {
      setSigningOut(false)
    }
  }
  const askSignOut = async (): Promise<void> => {
    const waiting = await store.syncState().then(
      (s) => s.waiting,
      () => null
    )
    if (waiting === null) setSignOutFailed(true)
    else if (waiting > 0) setWarnWaiting(waiting)
    else await signOut()
  }

  const refreshData = async (): Promise<void> => {
    setRefresh({ state: 'running', step: 'Checking for new cards…' })
    let step: 'cards' | 'artwork' = 'cards'
    try {
      // Through the api, so the pages refetch when cards changed.
      const status = await api.sync.run()
      if (status.error) {
        setRefresh({ state: 'error', message: REFRESH_FAILED.cards })
        return
      }
      step = 'artwork'
      setRefresh({ state: 'running', step: 'Checking the artwork data…' })
      const fingerprints = await refreshAllFingerprints(store, { force: true })
      void qc.invalidateQueries({ queryKey: CATALOG_KEY })
      setRefresh(
        fingerprints.state === 'error'
          ? { state: 'error', message: REFRESH_FAILED.artwork }
          : { state: 'done' }
      )
    } catch {
      // The app's data stopped answering: the button comes back for another try.
      setRefresh({ state: 'error', message: REFRESH_FAILED[step] })
    }
  }

  const problems = sync.data?.problems ?? 0
  const age = cardDataAge(catalog.data?.lastSyncAt ?? null)

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 pb-8 pt-2">
      <h1 className="px-1 text-3xl font-bold tracking-tight">Settings</h1>

      <section aria-label="Account" className="space-y-2">
        <Group>
          <Row>
            {user.avatarUrl && <img src={user.avatarUrl} alt="" className="size-8 rounded-full" />}
            <span>Signed in as {name}</span>
            <span className="text-muted-foreground">@{user.username}</span>
          </Row>
          <button
            type="button"
            className={rowButton}
            disabled={signingOut}
            onClick={() => void askSignOut()}
          >
            Sign out
          </button>
        </Group>
        <div className="rounded-2xl border border-white/[0.06] bg-card p-4">
          <SignInMethods
            linkable={linkable}
            linking={linking}
            onLink={(p) => void link(p)}
            onMerge={(ticket, preview) => setMerge({ ticket, preview })}
          />
          {merge && (
            <MergeDialog
              preview={merge.preview}
              onMerge={doMerge}
              onCancel={() => setMerge(null)}
            />
          )}
        </div>
        {signOutFailed && (
          <p role="alert" className="px-4 text-[13px] text-destructive">
            {SIGN_OUT_FAILED}
          </p>
        )}
      </section>

      <section aria-label="Card data" className="space-y-2">
        <Group>
          <button
            type="button"
            className={rowButton}
            disabled={refresh.state === 'running'}
            onClick={() => void refreshData()}
          >
            Refresh card data
          </button>
          {problems > 0 && (
            <button type="button" className={rowButton} onClick={() => setProblemsOpen(true)}>
              Sync problems ({problems})
            </button>
          )}
        </Group>
        <p role="status" className="px-4 text-[13px] text-muted-foreground">
          {refresh.state === 'running'
            ? refresh.step
            : refresh.state === 'done'
              ? 'Card data is up to date.'
              : refresh.state === 'error'
                ? refresh.message
                : age}
        </p>
      </section>

      {onContribute && testerGame !== undefined && (
        <section aria-label="Contribute photos" className="space-y-2">
          <Group>
            <button type="button" className={rowButton} onClick={() => onContribute(testerGame)}>
              Contribute photos
            </button>
          </Group>
        </section>
      )}

      <section aria-label="About" className="space-y-2">
        <Group>
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className={rowButton}>
            Privacy
          </a>
          <ScanPingToggle className="flex min-h-12 items-start gap-3 px-4 py-3 text-[15px]" />
          <Row>
            {/* The stream's hit moment: the same setting as the stream's start screen. */}
            <HitPriceInput
              value={settings.hitPrice}
              onCommit={(hitPrice) => setSettings({ hitPrice })}
              className="text-base text-foreground"
            />
          </Row>
          <EbayPricesToggle className="flex min-h-12 items-start gap-3 px-4 py-3 text-[15px]" />
          <WishlistToggle className="flex min-h-12 items-start gap-3 px-4 py-3 text-[15px]" />
          <UsageToggle className="flex min-h-12 items-start gap-3 px-4 py-3 text-[15px]" />
          <Row>
            <span className="text-muted-foreground">
              {[age, version.data ? `Version ${version.data}` : null].filter(Boolean).join(' · ')}
            </span>
          </Row>
        </Group>
        <ScreenDetails />
      </section>

      <section aria-label="Delete account" className="flex justify-center pt-2">
        <DeleteAccount
          onDeleted={() => {
            forgetSavedScans()
            void webLogout().finally(signedOut)
          }}
        />
      </section>

      <SyncProblems open={problemsOpen} onOpenChange={setProblemsOpen} />

      <Dialog open={warnWaiting !== null} onOpenChange={(o) => !o && setWarnWaiting(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>{signOutWarning(warnWaiting ?? 0, name)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWarnWaiting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={signingOut}
              onClick={() => {
                setWarnWaiting(null)
                void signOut()
              }}
            >
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
