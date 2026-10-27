import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useAccountStatus, useApplyAccountStatus } from '@/lib/account'
import { formatRelative } from '@/lib/format'
import { isWeb } from '@/lib/platform'
import { fetchMe } from '@/web/account'
import type { Me } from '@shared/cloud'

function Identity({ user }: { user: Me }): React.JSX.Element {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const { avatarUrl, displayName, username } = user
  return (
    <div className="flex items-center gap-3">
      {avatarUrl && !avatarFailed && (
        <img src={avatarUrl} alt="" className="size-8 rounded-full" onError={() => setAvatarFailed(true)} />
      )}
      <span>Signed in as {displayName ?? username}</span>
    </div>
  )
}

export function AccountSection(): React.JSX.Element {
  return isWeb() ? <WebAccount /> : <DesktopAccount />
}

function DesktopAccount(): React.JSX.Element {
  const s = useAccountStatus()
  const apply = useApplyAccountStatus()
  if (!s) return <p className="text-sm text-muted-foreground">Loading account…</p>

  const pending =
    s.pendingCount > 0 ? (
      <p className="text-sm text-muted-foreground">
        {s.pendingCount} cards from your account are waiting for newer card data. Refresh card data to bring them in.
      </p>
    ) : null

  if (s.state === 'signed-out') {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Sign in with Discord to keep this computer&apos;s collection in step with the web app and your other
          computers.
        </p>
        {s.localOwner && (
          <p className="text-muted-foreground">
            Showing {s.localOwner}&apos;s cards. Changes are kept and sync when {s.localOwner} signs in again.
          </p>
        )}
        {s.error && <p className="text-destructive">{s.error}</p>}
        {pending}
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
        <span className="text-right tabular-nums">{s.lastSyncedAt ? formatRelative(s.lastSyncedAt) : 'never'}</span>
      </div>
      {s.state === 'offline' && (
        <p className="text-muted-foreground">Offline. Changes will sync when you&apos;re back online.</p>
      )}
      {s.state === 'error' && <p className="text-destructive">Sync failed: {s.error}</p>}
      {pending}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={s.state === 'syncing'} onClick={() => apply(api.account.syncNow())}>
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
      <form method="post" action="/auth/logout">
        <Button type="submit" variant="outline" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  )
}
