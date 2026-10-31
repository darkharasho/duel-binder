import { useFriendsWithCard } from '@/lib/friendCards'
import { FriendAvatar } from './FriendAvatar'

/** Codes named per friend; the rest are counted. */
const MAX_CODES = 3

/**
 * Which friends have this card and how many, across its printings. Loads after the panel renders;
 * shows nothing while it loads, when signed out, when no friend has the card, or when the portal
 * can't answer (an older portal has no such call).
 */
export function FriendCopies({ cardId }: { cardId: number }): React.JSX.Element | null {
  const { data: friends } = useFriendsWithCard(cardId)
  if (!friends?.length) return null
  return (
    <section aria-label="Friends with this card" className="space-y-1.5">
      <h3 className="text-sm font-medium">Friends with this card</h3>
      <ul className="space-y-1.5">
        {friends.map((f) => {
          // Finishes of one Pokémon card share a code.
          const all = [...new Set(f.printings.map((p) => p.setCode || p.rarity))]
          const codes = all.slice(0, MAX_CODES)
          const more = all.length - codes.length
          return (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <FriendAvatar user={f} className="size-6 text-xs" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{f.displayName ?? f.username}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {codes.join(', ')}
                  {more > 0 && ` and ${more} more`}
                </div>
              </div>
              <span className="tabular-nums text-muted-foreground">×{f.quantity}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
