import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { englishSetName } from '@shared/setNames'
import type { ChecklistCard } from '@shared/types'
import { CardDetails } from '@/components/CardDetails'
import { PanelPrice } from '@/components/PanelPrice'
import { PanelCardArt } from '@/components/PanelCardArt'
import type { PanelNav } from '@/components/panelNav'
import { Button } from '@/components/ui/button'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api, queryKeys } from '@/lib/api'
import { isPhone } from '@/lib/platform'
import { BulkRow } from './BulkRow'

interface SetCardPanelProps {
  setName: string
  card: ChecklistCard
  /** The rarity whose tile was opened; listed first and shown in the art. */
  rarity: string | null
  busy: boolean
  onAdjust: (printingId: number, delta: 1 | -1) => void
  /** Opens the full Add Card dialog (artwork, quantity, notes). */
  onMoreOptions: (printingId: number) => void
  nav?: PanelNav
}

/**
 * A card of a set, owned or not, with a −/count/+ stepper per rarity it was printed in there.
 * Rendered inside a CardSheet.
 */
export function SetCardPanel({
  setName,
  card,
  rarity,
  busy,
  onAdjust,
  onMoreOptions,
  nav
}: SetCardPanelProps): React.JSX.Element {
  const detail = useQuery({
    queryKey: queryKeys.card(card.cardId),
    queryFn: () => api.cards.get(card.cardId)
  })
  const copies = useQuery({
    queryKey: queryKeys.forCard(card.cardId),
    queryFn: () => api.collection.forCard(card.cardId)
  })
  const info = detail.data?.card
  const typeLine = info
    ? [info.type, info.attribute, info.race].filter(Boolean).join(' · ')
    : card.type
  const opened = card.rarities.find((r) => r.rarity === rarity) ?? card.rarities[0]
  const rarities = opened ? [opened, ...card.rarities.filter((r) => r !== opened)] : card.rarities
  // The rarity the user clicked (for this card only); until then the one whose tile was opened.
  const [pick, setPick] = useState<{ cardId: number; rarity: string } | null>(null)
  const focus =
    (pick?.cardId === card.cardId && card.rarities.find((r) => r.rarity === pick.rarity)) || opened
  // Rarities of one card can differ by orders of magnitude, so price the one being viewed.
  const price = focus?.price ?? card.price
  const priceLabel = focus?.price != null ? focus.rarity : 'cheapest printing'
  // An owned printing shows the price the collection shows (eBay-first), not YGOPRODeck's.
  const ownedEntry = focus
    ? (copies.data ?? []).find((c) => c.printing.id === focus.defaultPrintingId)
    : undefined

  const copiesSection = (
    <section aria-label="Copies in this set" className="space-y-2">
      <h3 className="text-sm font-medium">
        {card.owned > 0 ? `You have ${card.owned}` : 'You have none yet'}
      </h3>
      {rarities.map((r) => (
        <BulkRow
          key={r.rarity}
          card={card}
          rarity={r}
          setName={setName}
          busy={busy}
          onAdjust={onAdjust}
          showPrice
          picked={r === focus}
          onPick={() => setPick({ cardId: card.cardId, rarity: r.rarity })}
        />
      ))}
    </section>
  )
  // The phone's full-screen sheet is long, so its steppers come before the card text.
  const phone = isPhone()

  return (
    <>
      <SheetHeader>
        <SheetTitle>{card.name}</SheetTitle>
        <SheetDescription>{typeLine}</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6">
        <PanelCardArt
          imageId={card.imageId}
          printingId={focus?.defaultPrintingId}
          alt={card.name}
          nav={nav}
        />
        <div className="space-y-1">
          <p className="font-mono text-[13px] text-muted-foreground">
            {englishSetName(setName)} · {card.numberLabel}
          </p>
          <PanelPrice entry={ownedEntry} price={price} label={priceLabel} />
        </div>

        {phone && copiesSection}
        <CardDetails
          card={info}
          printing={
            focus && {
              setCode:
                focus.codes.find((c) => c.printingId === focus.defaultPrintingId)?.setCode ?? '',
              setRarity: focus.rarity
            }
          }
        />
        {!phone && copiesSection}

        {focus && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMoreOptions(focus.defaultPrintingId)}
          >
            More options…
          </Button>
        )}
      </div>
    </>
  )
}
