import { ExternalLink } from 'lucide-react'
import { AFFILIATE, buyLinks, type AffiliateIds } from '@shared/affiliate'
import { gameOfId } from '@shared/games/ids'
import type { Printing } from '@shared/types'
import { buttonVariants } from '@/components/ui/button'
import { track } from '@/lib/usage'
import { cn } from '@/lib/utils'

export const AFFILIATE_DISCLOSURE = 'Affiliate links: we may earn a commission.'

const SHORT: Record<string, string> = { tcgplayer: 'TCGplayer', ebay: 'eBay' }

/**
 * Affiliate links to buy the printing on TCGplayer and eBay; nothing when no store's id is set.
 * Plain links: Electron sends https window opens to the browser, the web and phone open them.
 */
export function BuyLinks({
  card,
  printing,
  ids = AFFILIATE,
  compact = false
}: {
  card: { id: number; name: string }
  printing: Printing | null | undefined
  ids?: AffiliateIds
  /** Short labels, with the disclosure as each link's tooltip (one row of a list). */
  compact?: boolean
}): React.JSX.Element | null {
  if (!printing) return null
  const links = buyLinks(
    {
      game: gameOfId(card.id),
      name: card.name,
      setCode: printing.setCode,
      setRarity: printing.setRarity,
      language: printing.language,
      tcgProductId: printing.tcgProductId
    },
    ids
  )
  if (links.length === 0) return null
  const row = (
    <div className="flex flex-wrap gap-1.5">
      {links.map((l) => (
        <a
          key={l.store}
          href={l.url}
          target="_blank"
          rel="noreferrer sponsored"
          title={compact ? AFFILIATE_DISCLOSURE : undefined}
          onClick={(e) => {
            e.stopPropagation()
            track(l.store === 'tcgplayer' ? 'buy:tcgplayer' : 'buy:ebay')
          }}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            compact ? 'h-7 gap-1 px-2 text-xs' : 'gap-1.5'
          )}
        >
          {compact ? SHORT[l.store] : l.label}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ))}
    </div>
  )
  if (compact) return row
  return (
    <div className="mt-3 space-y-1.5">
      {row}
      <p className="text-xs text-muted-foreground">{AFFILIATE_DISCLOSURE}</p>
    </div>
  )
}
