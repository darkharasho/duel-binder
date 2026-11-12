import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoadingState } from '@/components/ui/loading'
import type { BinderSummary, Friend } from '@shared/types'
import { PageHeader } from '@/components/PageHeader'
import { api, queryKeys } from '@/lib/api'
import { useBackHandler } from '@/lib/backStack'
import { BackToBinders, Row, SHELF } from './BindersPage'
import { BinderView } from './BinderView'

function Open({
  friend,
  uid,
  header,
  onBack
}: {
  friend: Friend
  uid: string
  header: React.ReactNode
  onBack: () => void
}): React.JSX.Element {
  useBackHandler(true, onBack)
  const q = useQuery({
    queryKey: queryKeys.friendBinder(friend.id, uid),
    queryFn: () => api.friends.binder(friend.id, uid),
    retry: false
  })
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>{header}</PageHeader>
      {q.data ? (
        <BinderView detail={q.data} readOnly back={<BackToBinders onBack={onBack} />} />
      ) : (
        <>
          <BackToBinders onBack={onBack} />
          {q.isPending ? (
            <LoadingState label="Loading the binder…" />
          ) : (
            <p className="text-sm text-muted-foreground">This binder isn&apos;t available.</p>
          )}
        </>
      )}
    </div>
  )
}

/** A friend's visible binders, read-only: a list, and one binder's slots when opened. */
export function FriendBinders({
  friend,
  binders,
  header
}: {
  friend: Friend
  binders: BinderSummary[]
  header: React.ReactNode
}): React.JSX.Element {
  const [uid, setUid] = useState<string | null>(null)
  if (uid) return <Open friend={friend} uid={uid} header={header} onBack={() => setUid(null)} />
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>{header}</PageHeader>
      <ul className={SHELF} aria-label="Binders">
        {binders.map((b) => (
          <Row key={b.uid} b={b} onOpen={() => setUid(b.uid)} />
        ))}
      </ul>
    </div>
  )
}
