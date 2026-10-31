import { Check, Minus, Plus, X } from 'lucide-react'
import { englishSetName } from '@shared/setNames'
import { MAX_WANTED } from '@shared/cloud'
import type { WishlistItem, WishOwners } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { LanguageTag } from '@/components/LanguageTag'
import { scanFor } from '@/components/scanFor'
import { Button } from '@/components/ui/button'
import { FriendAvatar } from '@/features/friends/FriendAvatar'
import { formatUsd } from '@/lib/format'
import { stillWanted } from '@/lib/wishlist'

/** Avatars shown per want; the rest are counted. */
const MAX_AVATARS = 3

const shownName = (f: WishOwners['friends'][number]): string => f.displayName ?? f.username

/** "Bob has this", "Bob and 2 others have this". */
function ownersLine(friends: WishOwners['friends']): string {
  const others = friends.length - 1
  if (others === 0) return `${shownName(friends[0])} has this`
  return `${shownName(friends[0])} and ${others} ${others === 1 ? 'other' : 'others'} have this`
}

function Owners({ friends }: { friends: WishOwners['friends'] }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className="flex shrink-0 -space-x-1.5">
        {friends.slice(0, MAX_AVATARS).map((f) => (
          <FriendAvatar key={f.id} user={f} className="size-5 text-[10px]" />
        ))}
      </span>
      <span className="truncate">{ownersLine(friends)}</span>
    </div>
  )
}

/** "Owned", or "1 of 3 owned" on the way to a target; nothing before the first copy. */
function OwnedMark({ item }: { item: WishlistItem }): React.JSX.Element | null {
  if (item.owned === 0) return null
  const done = stillWanted(item) === 0
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
      {done && <Check className="size-3" />}
      {done ? 'Owned' : `${item.owned} of ${item.quantity} owned`}
    </span>
  )
}

/** The copies wanted: "Any" with no target, down to one more than owned, then back to "Any". */
function WantStepper({
  item,
  label,
  onChange
}: {
  item: WishlistItem
  label: string
  onChange: (quantity: number | null) => void
}): React.JSX.Element {
  const q = item.quantity
  const floor = item.owned + 1
  return (
    <div
      role="group"
      aria-label={`Copies wanted of ${label}`}
      className="flex items-center gap-1 max-md:mr-auto max-md:pl-[3.75rem]"
    >
      <span className="mr-1 text-xs text-muted-foreground">Want</span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`Want fewer ${label}`}
        disabled={q === null}
        onClick={() => onChange(q !== null && q > floor ? q - 1 : null)}
      >
        <Minus />
      </Button>
      <span className="w-9 text-center text-sm tabular-nums">{q ?? 'Any'}</span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`Want more ${label}`}
        disabled={q !== null && q >= MAX_WANTED}
        onClick={() => onChange(q === null ? floor : q + 1)}
      >
        <Plus />
      </Button>
    </div>
  )
}

/**
 * A wishlist as rows: art, name, the type wanted and its price, opening the card when picked.
 * `onQuantity` and `onRemove` make it the owner's; without them it's a friend's, read-only.
 */
export function WishlistRows({
  items,
  owners,
  onOpen,
  onQuantity,
  onRemove
}: {
  items: WishlistItem[]
  owners?: Map<string, WishOwners['friends']>
  onOpen: (item: WishlistItem) => void
  onQuantity?: (item: WishlistItem, quantity: number | null) => void
  onRemove?: (item: WishlistItem) => void
}): React.JSX.Element {
  return (
    <ul aria-label="Wanted cards" className="divide-y divide-white/[0.06]">
      {items.map((item) => {
        const p = item.printing
        const label = `${item.card.name} ${p.setCode} ${p.setRarity}`
        const friends = owners?.get(item.pkey)
        return (
          <li key={item.pkey} className="flex items-center gap-3 py-2.5 max-md:flex-wrap">
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring max-md:basis-full"
            >
              <CardArt
                imageId={item.imageId}
                printingId={scanFor(item)}
                size="small"
                alt=""
                className="w-12 shrink-0 rounded-sm"
              />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block truncate text-sm font-medium">{item.card.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">{englishSetName(p.setName, p.setCode)}</span>
                  <LanguageTag language={p.language} />
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {p.setCode} · {p.setRarity}
                </span>
                <OwnedMark item={item} />
                {friends && friends.length > 0 && <Owners friends={friends} />}
              </span>
              <span className="shrink-0 text-sm tabular-nums">
                {item.priceApproximate && item.unitPrice !== null && '~'}
                {formatUsd(item.unitPrice)}
              </span>
            </button>
            {onQuantity && (
              <WantStepper item={item} label={label} onChange={(q) => onQuantity(item, q)} />
            )}
            {onRemove && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${label} from wishlist`}
                onClick={() => onRemove(item)}
              >
                <X />
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
