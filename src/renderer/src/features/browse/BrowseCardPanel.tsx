import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { BrowseCard, Printing } from '@shared/types'
import { CardDetails } from '@/components/CardDetails'
import { PanelCardArt } from '@/components/PanelCardArt'
import { LanguageTag } from '@/components/LanguageTag'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { api, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { createSerialQueue } from '@/lib/serialQueue'
import { cn } from '@/lib/utils'

interface BrowseCardPanelProps {
  card: BrowseCard
  /** Opens the full Add Card dialog (artwork, quantity, notes). */
  onMoreOptions: (printingId: number) => void
  onClose: () => void
}

/** A card from Browse with a −/count/+ stepper per printing; English printings first. */
export function BrowseCardPanel({
  card,
  onMoreOptions,
  onClose
}: BrowseCardPanelProps): React.JSX.Element {
  const qc = useQueryClient()
  const queue = useRef(createSerialQueue())
  const [pending, setPending] = useState(0)
  const detail = useQuery({
    queryKey: queryKeys.card(card.id),
    queryFn: () => api.cards.get(card.id)
  })
  const copies = useQuery({
    queryKey: queryKeys.forCard(card.id),
    queryFn: () => api.collection.forCard(card.id)
  })
  const info = detail.data?.card
  const typeLine = info
    ? [info.type, info.attribute, info.race].filter(Boolean).join(' · ')
    : card.type
  const printings = [...(detail.data?.printings ?? [])].sort(
    (a, b) => Number(a.language !== 'en') - Number(b.language !== 'en')
  )
  const ownedOf = (printingId: number): number =>
    (copies.data ?? [])
      .filter((c) => c.printing.id === printingId)
      .reduce((n, c) => n + c.quantity, 0)
  const total = (copies.data ?? []).reduce((n, c) => n + c.quantity, 0)
  const moreFor = card.defaultPrintingId ?? printings[0]?.id

  const adjust = (p: Printing, delta: 1 | -1): void => {
    setPending((n) => n + 1)
    queue
      .current(async () => {
        await api.sets.adjust(p.setName, p.language, p.id, delta)
        await Promise.all(
          mutationInvalidationKeys.map((k) => qc.invalidateQueries({ queryKey: [...k] }))
        )
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Could not update the collection')
      })
      .finally(() => setPending((n) => n - 1))
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>{card.name}</SheetTitle>
          <SheetDescription>{typeLine}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <PanelCardArt
            imageId={card.imageId}
            printingId={card.defaultPrintingId}
            alt={card.name}
          />

          <CardDetails card={info} />

          <section aria-label="Printings" className="space-y-2">
            <h3 className="text-sm font-medium">
              {total > 0 ? `You have ${total}` : 'You have none yet'}
            </h3>
            {printings.map((p) => {
              const owned = ownedOf(p.id)
              const label = `${card.name} ${p.setCode} ${p.setRarity}`
              return (
                <div
                  key={p.id}
                  role="group"
                  aria-label={label}
                  className="flex items-center gap-1.5"
                >
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{p.setName}</span>
                      <LanguageTag language={p.language} />
                    </div>
                    <div className="truncate text-muted-foreground">
                      {p.setCode} · {p.setRarity}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Remove one ${label}`}
                    disabled={owned === 0}
                    onClick={() => adjust(p, -1)}
                  >
                    <Minus />
                  </Button>
                  <span
                    aria-busy={pending > 0}
                    className={cn(
                      'w-6 text-center text-sm tabular-nums',
                      pending > 0 && 'text-muted-foreground'
                    )}
                  >
                    {owned}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Add one ${label}`}
                    onClick={() => adjust(p, 1)}
                  >
                    <Plus />
                  </Button>
                </div>
              )
            })}
          </section>

          {moreFor !== undefined && (
            <Button variant="outline" size="sm" onClick={() => onMoreOptions(moreFor)}>
              More options…
            </Button>
          )}

        </div>
      </SheetContent>
    </Sheet>
  )
}
