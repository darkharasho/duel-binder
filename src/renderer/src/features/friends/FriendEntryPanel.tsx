import type { EntryView } from '@shared/types'
import { CardDetails } from '@/components/CardDetails'
import { LanguageTag } from '@/components/LanguageTag'
import { PanelCardArt } from '@/components/PanelCardArt'
import { cardFoil } from '@shared/foil'
import type { PanelNav } from '@/components/panelNav'
import { scanFor } from '@/components/scanFor'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { EbayPriceLine, EntryValue, displayTotal } from '../collection/EntryValue'

/** A friend's card with their copies, read-only; rendered inside a CardSheet. Fetches nothing. */
export function FriendEntryPanel({
  entry,
  copies,
  onSelectEntry,
  nav
}: {
  entry: EntryView
  copies: EntryView[]
  onSelectEntry: (id: number) => void
  nav?: PanelNav
}): React.JSX.Element {
  const card = entry.card
  const typeLine = [card.type, card.attribute, card.race].filter(Boolean).join(' · ')
  return (
    <>
      <SheetHeader>
        <SheetTitle>{card.name}</SheetTitle>
        <SheetDescription>{typeLine}</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6">
        <PanelCardArt
          imageId={entry.imageId}
          printingId={scanFor(entry)}
          alt={card.name}
          nav={nav}
          foil={cardFoil(entry.printing, card)}
        />
        <CardDetails card={card} printing={entry.printing} />

        {copies.length > 0 && (
          <section aria-label="Their copies" className="space-y-1.5">
            <h3 className="text-sm font-medium">Their copies</h3>
            <ul className="space-y-1">
              {copies.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={c.id === entry.id}
                    onClick={() => onSelectEntry(c.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      c.id === entry.id ? 'bg-accent' : 'hover:bg-accent/50'
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      {c.printing.setCode} · {c.printing.setRarity}
                      <LanguageTag language={c.printing.language} />
                    </span>
                    <span className="tabular-nums text-muted-foreground">×{c.quantity}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Value</span>
          <EntryValue entry={entry} amount={displayTotal(entry)} />
        </div>
        <EbayPriceLine entry={entry} />
      </div>
    </>
  )
}
