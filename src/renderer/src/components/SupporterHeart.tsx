import { Heart } from 'lucide-react'

/** The supporter badge: a small filled heart after a name. Only supporters get one. */
export function SupporterHeart(): React.JSX.Element {
  return (
    <span role="img" aria-label="Supporter" title="Supporter" className="inline-flex shrink-0">
      <Heart aria-hidden className="size-3.5 fill-rose-500 text-rose-500" />
    </span>
  )
}
