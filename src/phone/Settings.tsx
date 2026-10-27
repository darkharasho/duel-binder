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
import { DeleteAccount } from '@/features/settings/AccountSection'
import { api } from '@/lib/api'
import { PRIVACY_URL, cardDataAge, signOutWarning } from './copy'
import { CATALOG_KEY, SYNC_STATE_KEY, displayName, usePhone } from './context'
import { SyncProblems } from './SyncProblems'

/** Ends the web session too, so the cookie doesn't sign the phone straight back in. */
async function webLogout(): Promise<void> {
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

/** The phone's Settings: the account, card data, sync problems, privacy and the app's version. */
export function Settings(): React.JSX.Element {
  const { store, user, signedOut } = usePhone()
  const qc = useQueryClient()
  const name = displayName(user)
  const [warnWaiting, setWarnWaiting] = useState<number | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [refresh, setRefresh] = useState<Refresh>({ state: 'idle' })
  const [problemsOpen, setProblemsOpen] = useState(false)

  const sync = useQuery({ queryKey: SYNC_STATE_KEY, queryFn: () => store.syncState() })
  const catalog = useQuery({ queryKey: CATALOG_KEY, queryFn: () => store.catalog() })
  const version = useQuery({ queryKey: ['phone', 'version'], queryFn: () => api.app.version() })

  const signOut = async (): Promise<void> => {
    setSigningOut(true)
    try {
      // The cookie goes first: the sign-in screen would otherwise trade it straight back.
      await webLogout()
      await api.account.signOut()
      signedOut()
    } finally {
      setSigningOut(false)
    }
  }
  const askSignOut = async (): Promise<void> => {
    const { waiting } = await store.syncState()
    if (waiting > 0) setWarnWaiting(waiting)
    else await signOut()
  }

  const refreshData = async (): Promise<void> => {
    setRefresh({ state: 'running', step: 'Checking for new cards…' })
    // Through the api, so the pages refetch when cards changed.
    const status = await api.sync.run()
    if (status.error) {
      setRefresh({ state: 'error', message: "Couldn't refresh the card data. Try again later." })
      return
    }
    setRefresh({ state: 'running', step: 'Checking the artwork data…' })
    const fingerprints = await store.refreshFingerprints({ force: true })
    void qc.invalidateQueries({ queryKey: CATALOG_KEY })
    setRefresh(
      fingerprints.state === 'error'
        ? { state: 'error', message: "Couldn't refresh the artwork data. Try again later." }
        : { state: 'done' }
    )
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

      <section aria-label="About" className="space-y-2">
        <Group>
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className={rowButton}>
            Privacy
          </a>
          <Row>
            <span className="text-muted-foreground">
              {[age, version.data ? `Version ${version.data}` : null].filter(Boolean).join(' · ')}
            </span>
          </Row>
        </Group>
      </section>

      <section aria-label="Delete account" className="flex justify-center pt-2">
        <DeleteAccount
          onDeleted={() => {
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
