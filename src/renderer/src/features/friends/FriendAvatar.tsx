import { useState } from 'react'
import type { FriendUser } from '@shared/types'
import { cn } from '@/lib/utils'

/** A friend's picture, or their initial when they have none or it doesn't load. */
export function FriendAvatar({
  user,
  className = 'size-8 text-sm'
}: {
  user: FriendUser
  /** Size classes; defaults to the Friends page's. */
  className?: string
}): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (user.avatarUrl && !failed) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        className={cn('shrink-0 rounded-full', className)}
        onError={() => setFailed(true)}
      />
    )
  }
  const name = user.displayName ?? user.username
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-white/10 font-semibold uppercase',
        className
      )}
    >
      {name.charAt(0)}
    </span>
  )
}
