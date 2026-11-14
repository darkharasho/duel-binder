import { useState } from 'react'
import { BookOpen, Heart, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { EmptyHero, EmptySteps } from '@/components/EmptyHero'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { RowsSkeleton } from '@/components/ui/loading'
import { useAccountUser } from '@/lib/accountUser'
import { api, queryKeys } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { friendsErrorMessage, useFriendsAvailable, useFriendsOverview } from '@/lib/friends'
import { isPhone } from '@/lib/platform'
import { FRIENDS_SIGNED_OUT } from '@shared/friends'
import type { Friend, FriendUser } from '@shared/types'
import { AddFriendForm } from './AddFriendForm'
import { FriendAvatar } from './FriendAvatar'
import { FriendBinder } from './FriendBinder'

type Confirming = { id: number; action: 'unfriend' | 'block' }

const friendStats = (f: Friend): string =>
  `${f.cardCount} ${f.cardCount === 1 ? 'card' : 'cards'} · Updated ${formatRelative(f.updatedAt)}`

/** What a friend lets you see, under the empty page's add form. */
const FRIEND_STEPS = [
  { icon: BookOpen, title: 'Look through their binder', text: 'Their cards, sets and binders.' },
  { icon: Heart, title: 'See what they want', text: 'Their wishlist, next to what you own.' },
  { icon: Users, title: 'Find who has a card', text: 'Every card shows which friends own it.' }
] as const

/** The Friends page with no friends and no requests: the add form, front and centre. */
function NoFriends(): React.JSX.Element {
  const { user } = useAccountUser()
  return (
    <EmptyHero
      id="no-friends"
      eyebrow="Friends"
      title="Collect with friends"
      blurb="Add a friend by their Duel Binder username. They get a request, and once they accept you can see each other's cards."
    >
      <AddFriendForm className="mx-auto mt-7 flex w-full max-w-md flex-col items-center [&_form]:w-full" />
      {user?.username && (
        <p className="mt-3 text-center text-sm text-muted-foreground">
          Your username is <span className="font-medium text-foreground">@{user.username}</span>
        </p>
      )}
      <EmptySteps steps={FRIEND_STEPS} />
    </EmptyHero>
  )
}

export function FriendsPage(): React.JSX.Element {
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
        <EmptyHero
          id="friends-signed-out"
          eyebrow="Friends"
          title="Collect with friends"
          blurb={FRIENDS_SIGNED_OUT}
        >
          <EmptySteps steps={FRIEND_STEPS} />
        </EmptyHero>
      </div>
    )
  }

  if (viewing) {
    return <FriendBinder key={viewing.id} friend={viewing} onBack={() => setViewing(null)} />
  }

  // On the phone the friend list and requests come first.
  const phone = isPhone()
  const data = overview.data
  // An older portal leaves out sent requests.
  const outgoing = data?.outgoing ?? []
  // No friends and nobody asking: the add form moves into the middle of the page, and stays there
  // while your own requests wait (they list under it).
  const empty = !!data && data.friends.length === 0 && data.incoming.length === 0
  // Until the list loads it isn't known where the add form goes.
  const formAtTop = !overview.isPending && !empty
  const sent = outgoing.length > 0 && (
    <section aria-label="Sent requests" className="space-y-2">
      <h2 className="text-sm font-semibold">Sent</h2>
      <ul className="space-y-2">
        {outgoing.map((r) => (
          <li key={r.id} className="flex items-center gap-3">
            <FriendAvatar user={r} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.displayName ?? r.username}</div>
              <div className="truncate text-xs text-muted-foreground">
                @{r.username} · Sent {formatRelative(r.sentAt)}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => act.mutate(() => api.friends.cancel(r.id))}
            >
              Cancel request
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      {header}
      {!phone && formAtTop && <AddFriendForm />}
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
              <li key={r.id} className="flex items-center gap-3 max-md:flex-wrap">
                <FriendAvatar user={r} />
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
      {overview.isLoading && <RowsSkeleton label="Loading friends" count={4} />}
      {empty && <NoFriends />}
      {empty && <div className="mx-auto max-w-xl">{sent}</div>}
      {data &&
        (data.friends.length === 0 ? (
          !empty && <p className="text-sm text-muted-foreground">No friends yet.</p>
        ) : (
          <section aria-label="Your friends" className="space-y-2">
            {/* Named only when requests sit above or below it. */}
            {(data.incoming.length > 0 || outgoing.length > 0 || data.blocked.length > 0) && (
              <h2 className="text-sm font-semibold">Friends</h2>
            )}
            <ul className="space-y-2">
              {data.friends.map((f) => (
                <li key={f.id} className="flex items-center gap-3 max-md:flex-wrap">
                  <button
                    type="button"
                    onClick={() => setViewing(f)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <FriendAvatar user={f} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {f.displayName ?? f.username}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        @{f.username}
                      </span>
                      {phone && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {friendStats(f)}
                        </span>
                      )}
                    </span>
                    {!phone && (
                      <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                        {friendStats(f)}
                      </span>
                    )}
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
          </section>
        ))}
      {!empty && sent}
      {phone && formAtTop && <AddFriendForm />}
      {data && data.blocked.length > 0 && (
        <section aria-label="Blocked" className="space-y-2">
          <h2 className="text-sm font-semibold">Blocked</h2>
          <ul className="space-y-2">
            {data.blocked.map((b) => (
              <li key={b.id} className="flex items-center gap-3">
                <FriendAvatar user={b} />
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
