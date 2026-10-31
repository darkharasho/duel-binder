import { useFriendsWanting } from '@/lib/wishlist'
import { FriendAvatar } from './FriendAvatar'

/** Codes named per friend; the rest are counted. */
const MAX_CODES = 3

/**
 * Friends who want a card you own. Loads after the panel renders; shows nothing while it loads,
 * when you own none, when no friend wants it, or when the portal can't answer.
 */
export function FriendWants({
  cardId,
  owned
}: {
  cardId: number
  owned: boolean
}): React.JSX.Element | null {
  const { data: friends } = useFriendsWanting(cardId, owned)
  if (!owned || !friends?.length) return null
  return (
    <section aria-label="Friends who want this card" className="space-y-1.5">
      <ul className="space-y-1.5">
        {friends.map((f) => {
          const all = [...new Set(f.printings.map((p) => p.setCode || p.rarity))]
          const more = all.length - MAX_CODES
          return (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <FriendAvatar user={f} className="size-6 text-xs" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{f.displayName ?? f.username} wants this</div>
                <div className="truncate text-xs text-muted-foreground">
                  {all.slice(0, MAX_CODES).join(', ')}
                  {more > 0 && ` and ${more} more`}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
