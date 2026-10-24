import { useQuery } from '@tanstack/react-query'
import type { ChecklistCard } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { api, queryKeys } from '@/lib/api'
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
  onClose: () => void
}

/** A card of a set, owned or not, with a −/count/+ stepper per rarity it was printed in there. */
export function SetCardPanel({
  setName,
  card,
  rarity,
  busy,
  onAdjust,
  onMoreOptions,
  onClose
}: SetCardPanelProps): React.JSX.Element {
  const detail = useQuery({
    queryKey: queryKeys.card(card.cardId),
    queryFn: () => api.cards.get(card.cardId)
  })
  const info = detail.data?.card
  const typeLine = info
    ? [info.type, info.attribute, info.race].filter(Boolean).join(' · ')
    : card.type
  const focus = card.rarities.find((r) => r.rarity === rarity) ?? card.rarities[0]
  const rarities = focus ? [focus, ...card.rarities.filter((r) => r !== focus)] : card.rarities

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>{card.name}</SheetTitle>
          <SheetDescription>{typeLine}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <CardArt
            imageId={card.imageId}
            printingId={focus?.defaultPrintingId}
            size="full"
            alt={card.name}
            className="mx-auto w-48"
          />
          <p className="font-mono text-[13px] text-muted-foreground">
            {setName} · {card.numberLabel}
          </p>

          <section aria-label="Copies in this set" className="space-y-2">
            <h3 className="text-sm font-medium">
              {card.owned > 0 ? `You have ${card.owned}` : 'You have none yet'}
            </h3>
            {rarities.map((r) => (
              <BulkRow key={r.rarity} card={card} rarity={r} busy={busy} onAdjust={onAdjust} />
            ))}
          </section>

          {focus && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMoreOptions(focus.defaultPrintingId)}
            >
              More options…
            </Button>
          )}

          {info?.desc && <p className="whitespace-pre-line text-sm">{info.desc}</p>}
        </div>
      </SheetContent>
    </Sheet>
  )
}
