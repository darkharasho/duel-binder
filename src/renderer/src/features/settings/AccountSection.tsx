import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LanguageTag } from '@/components/LanguageTag'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useAccountStatus, useApplyAccountStatus } from '@/lib/account'
import { formatRelative } from '@/lib/format'
import { isWeb } from '@/lib/platform'
import { fetchMe } from '@/web/account'
import type { Me } from '@shared/cloud'
import { DELETE_WARNING, reasonText } from './accountText'

function Identity({ user }: { user: Me }): React.JSX.Element {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const { avatarUrl, displayName, username } = user
  return (
    <div className="flex items-center gap-3">
      {avatarUrl && !avatarFailed && (
        <img
          src={avatarUrl}
          alt=""
          className="size-8 rounded-full"
          onError={() => setAvatarFailed(true)}
        />
      )}
      <span>Signed in as {displayName ?? username}</span>
    </div>
  )
}

export function AccountSection(): React.JSX.Element {
  return isWeb() ? <WebAccount /> : <DesktopAccount />
}

function UnsyncedNotice({ count }: { count: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const list = useQuery({
    queryKey: ['account', 'unsynced', count],
    queryFn: () => api.account.unsynced(),
    enabled: open
  })
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-muted-foreground">
        {count === 1 ? '1 card' : `${count} cards`} can&apos;t reach your account yet.
      </p>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Show
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cards that can&apos;t sync</DialogTitle>
            <DialogDescription>
              These stay on this computer until the server can take them.
            </DialogDescription>
          </DialogHeader>
          {list.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : list.isError ? (
            <p className="text-sm text-destructive">Couldn&apos;t load the list</p>
          ) : list.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to show.</p>
          ) : (
            <ul className="max-h-96 space-y-3 overflow-y-auto text-sm">
              {list.data.map((e) => (
                <li key={e.uid} className="space-y-0.5">
                  <div className="flex justify-between gap-4">
                    <span className="font-medium">{e.name}</span>
                    <span className="tabular-nums">×{e.quantity}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span>{[e.setCode, e.setName, e.rarity].filter(Boolean).join(' · ')}</span>
                    <LanguageTag language={e.language} />
                  </div>
                  <div className="text-muted-foreground">{reasonText(e.reason)}</div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DesktopAccount(): React.JSX.Element {
  const s = useAccountStatus()
  const apply = useApplyAccountStatus()
  if (!s) return <p className="text-sm text-muted-foreground">Loading account…</p>

  const pending =
    s.pendingCount > 0 ? (
      <p className="text-sm text-muted-foreground">
        {s.pendingCount} cards from your account are waiting for newer card data. Refresh card data
        to bring them in.
      </p>
    ) : null

  const unsynced = s.unsyncedCount > 0 ? <UnsyncedNotice count={s.unsyncedCount} /> : null

  if (s.state === 'signed-out') {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Sign in with Discord to keep this computer&apos;s collection in step with the web app and
          your other computers.
        </p>
        {s.localOwner && (
          <p className="text-muted-foreground">
            Showing {s.localOwner}&apos;s cards. Changes are kept and sync when {s.localOwner} signs
            in again.
          </p>
        )}
        {s.error && <p className="text-destructive">{s.error}</p>}
        {pending}
        {unsynced}
        <Button size="sm" onClick={() => apply(api.account.signIn())}>
          Sign in with Discord
        </Button>
      </div>
    )
  }
  if (s.state === 'signing-in') {
    return (
      <div className="flex items-center justify-between gap-4 text-sm">
        <p className="text-muted-foreground">Finish signing in in your browser…</p>
        <Button variant="outline" size="sm" onClick={() => apply(api.account.signOut())}>
          Cancel
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-3 text-sm">
      {s.user && <Identity user={s.user} />}
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Last synced</span>
        <span className="text-right tabular-nums">
          {s.lastSyncedAt ? formatRelative(s.lastSyncedAt) : 'never'}
        </span>
      </div>
      {s.state === 'offline' && (
        <p className="text-muted-foreground">
          Offline. Changes will sync when you&apos;re back online.
        </p>
      )}
      {s.state === 'error' && <p className="text-destructive">Sync failed: {s.error}</p>}
      {pending}
      {unsynced}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={s.state === 'syncing'}
          onClick={() => apply(api.account.syncNow())}
        >
          Sync now
        </Button>
        <Button variant="outline" size="sm" onClick={() => apply(api.account.signOut())}>
          Sign out
        </Button>
      </div>
      <p className="text-muted-foreground">Signing out keeps your cards on this computer.</p>
    </div>
  )
}

/**
 * Web and phone: asks first, then deletes the portal account. On the web the page then leaves for
 * the front page; the phone passes `onDeleted` to show its sign-in screen.
 */
export function DeleteAccount({ onDeleted }: { onDeleted?: () => void } = {}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onOpenChange = (next: boolean): void => {
    if (busy) return
    setOpen(next)
    setError(null)
  }
  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // On success the web page leaves, so the buttons stay disabled until it does.
      await api.account.deleteAccount()
      onDeleted?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete your account")
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => onOpenChange(true)}>
        Delete account
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
            <DialogDescription>{DELETE_WARNING}</DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function WebAccount(): React.JSX.Element {
  const me = useQuery({ queryKey: ['me'], queryFn: () => fetchMe() })

  if (me.isPending) return <p className="text-sm text-muted-foreground">Loading account…</p>
  if (me.isError) return <p className="text-sm text-destructive">Couldn&apos;t load your account</p>
  if (!me.data) {
    return (
      <p className="flex gap-3 text-sm text-muted-foreground">
        <span>Not signed in</span>
        <a href="/" className="underline underline-offset-2 hover:text-foreground">
          Sign in
        </a>
      </p>
    )
  }
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <Identity user={me.data} />
      <div className="flex items-center gap-2">
        <form method="post" action="/auth/logout">
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
        <DeleteAccount />
      </div>
    </div>
  )
}
