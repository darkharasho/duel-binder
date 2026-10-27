import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { friendsErrorMessage, useFriendsAvailable, useFriendsOverview } from '@/lib/friends'
import { FRIENDS_SIGNED_OUT } from '@shared/friends'
import type { Friend, FriendUser } from '@shared/types'
import { CollectionPage } from '../collection/CollectionPage'
import { AddFriendForm } from './AddFriendForm'

function Avatar({ user }: { user: FriendUser }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (user.avatarUrl && !failed) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        className="size-8 shrink-0 rounded-full"
        onError={() => setFailed(true)}
      />
    )
  }
  const name = user.displayName ?? user.username
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold uppercase"
    >
      {name.charAt(0)}
    </span>
  )
}

type Confirming = { id: number; action: 'unfriend' | 'block' }

export function FriendsPage({ onBackToMine }: { onBackToMine: () => void }): React.JSX.Element {
  const qc = useQueryClient()
  const available = useFriendsAvailable()
  const overview = useFriendsOverview()
  const [viewing, setViewing] = useState<Friend | null>(null)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: queryKeys.friends })
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSettled: refresh
  })

  const isConfirming = (id: number, action: Confirming['action']): boolean =>
    confirming?.id === id && confirming.action === action
  /** "Unfriend Bob?" / "Block Bob?" with Confirm and Cancel, in place of the row's buttons. */
  const confirmButtons = (user: FriendUser, run: () => Promise<void>): React.JSX.Element => (
    <>
      <span className="text-sm">
        {confirming?.action === 'block' ? 'Block' : 'Unfriend'} {user.displayName ?? user.username}?
      </span>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          setConfirming(null)
          act.mutate(run)
        }}
      >
        Confirm
      </Button>
      <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
        Cancel
      </Button>
    </>
  )
  const blockButton = (user: FriendUser): React.JSX.Element => (
    <Button
      size="sm"
      variant="ghost"
      disabled={act.isPending}
      onClick={() => setConfirming({ id: user.id, action: 'block' })}
    >
      Block
    </Button>
  )

  const header = (
    <PageHeader>
      <h1 className="text-2xl font-semibold tracking-tight">Friends</h1>
    </PageHeader>
  )

  if (!available) {
    return (
      <div className="space-y-4 p-8 max-md:p-4">
        {header}
        <p className="text-sm text-muted-foreground">{FRIENDS_SIGNED_OUT}</p>
      </div>
    )
  }

  if (viewing) return <CollectionPage friend={viewing} onBackToMine={onBackToMine} />

  const data = overview.data
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      {header}
      <AddFriendForm />
      {overview.isError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-muted-foreground">
            {friendsErrorMessage(overview.error)}
          </p>
          <Button variant="outline" onClick={() => void overview.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {act.isError && (
        <p role="alert" className="text-sm text-destructive">
          {friendsErrorMessage(act.error)}
        </p>
      )}
      {data && data.incoming.length > 0 && (
        <section aria-label="Friend requests" className="space-y-2">
          <h2 className="text-sm font-semibold">Requests</h2>
          <ul className="space-y-2">
            {data.incoming.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <Avatar user={r} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.displayName ?? r.username}</div>
                  <div className="truncate text-xs text-muted-foreground">@{r.username}</div>
                </div>
                {isConfirming(r.id, 'block') ? (
                  confirmButtons(r, () => api.friends.block(r.id))
                ) : (
                  <>
                    <Button
                      size="sm"
                      disabled={act.isPending}
                      onClick={() => act.mutate(() => api.friends.accept(r.id))}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={act.isPending}
                      onClick={() => act.mutate(() => api.friends.ignore(r.id))}
                    >
                      Ignore
                    </Button>
                    {blockButton(r)}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data &&
        (data.friends.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No friends yet. Add one by their Discord username.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.friends.map((f) => (
              <li key={f.id} className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setViewing(f)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Avatar user={f} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {f.displayName ?? f.username}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{f.username}
                    </span>
                  </span>
                  <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                    {f.cardCount} {f.cardCount === 1 ? 'card' : 'cards'} · Updated{' '}
                    {formatRelative(f.updatedAt)}
                  </span>
                </button>
                {isConfirming(f.id, 'unfriend') ? (
                  confirmButtons(f, () => api.friends.remove(f.id))
                ) : isConfirming(f.id, 'block') ? (
                  confirmButtons(f, () => api.friends.block(f.id))
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirming({ id: f.id, action: 'unfriend' })}
                    >
                      Unfriend
                    </Button>
                    {blockButton(f)}
                  </>
                )}
              </li>
            ))}
          </ul>
        ))}
      {data && data.blocked.length > 0 && (
        <section aria-label="Blocked" className="space-y-2">
          <h2 className="text-sm font-semibold">Blocked</h2>
          <ul className="space-y-2">
            {data.blocked.map((b) => (
              <li key={b.id} className="flex items-center gap-3">
                <Avatar user={b} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{b.displayName ?? b.username}</div>
                  <div className="truncate text-xs text-muted-foreground">@{b.username}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() => act.mutate(() => api.friends.unblock(b.id))}
                >
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
