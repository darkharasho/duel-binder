import { useState } from 'react'
import { MinusIcon, PinIcon, PlusIcon, StarIcon } from 'lucide-react'
import type { SectionDef } from '@shared/decks/formats'
import type { DeckCard, DeckEntry, DeckSection } from '@shared/decks/types'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  DRAG_CARD,
  DRAG_ENTRY,
  SECTION_HEADING,
  entryDomId,
  entryKey,
  unknownCardText
} from './deckEntries'
import { PrintingPicker, type EntryActions } from './DeckSection'

const BADGE_PILL =
  'pointer-events-none absolute rounded-full bg-black/75 px-1.5 font-mono text-[10.5px] font-semibold leading-[18px] text-white'

export interface GridSection {
  def: SectionDef
  entries: DeckEntry[]
}

/**
 * The deck as card art, a grid per section. A tile shows its copies and what you still need; for
 * the owner a click opens its controls, and tiles and search results drop onto a section.
 */
export function DeckGrid({
  sections,
  cards,
  printingArt,
  have,
  cover,
  highlight,
  flagged,
  phone,
  actions,
  onDropCard
}: {
  sections: GridSection[]
  cards: Record<number, DeckCard>
  printingArt: Record<string, number>
  have: Map<string, number>
  cover: number | null
  highlight: string | null
  /** Cards a problem names, by how bad. */
  flagged: Map<number, 'error' | 'warning'>
  phone: boolean
  actions?: EntryActions
  onDropCard?: (card: DeckCard, section: DeckSection) => void
}): React.JSX.Element {
  const [over, setOver] = useState<DeckSection | null>(null)
  const all = sections.flatMap((s) => s.entries)
  const accepts = (e: React.DragEvent): boolean =>
    !!actions &&
    (e.dataTransfer.types.includes(DRAG_ENTRY) ||
      (!!onDropCard && e.dataTransfer.types.includes(DRAG_CARD)))
  const drop = (e: React.DragEvent, section: DeckSection): void => {
    setOver(null)
    if (!actions) return
    const key = e.dataTransfer.getData(DRAG_ENTRY)
    if (key) {
      const from = all.find((x) => entryKey(x) === key)
      if (from && from.section !== section) actions.onMove(from, section)
      return
    }
    const raw = e.dataTransfer.getData(DRAG_CARD)
    if (raw && onDropCard) {
      try {
        onDropCard(JSON.parse(raw) as DeckCard, section)
      } catch {
        // Not ours after all.
      }
    }
  }
  return (
    <div className="space-y-5">
      {sections.map(({ def, entries }) => {
        const count = entries.reduce((n, e) => n + e.qty, 0)
        return (
          <section
            key={def.id}
            aria-label={def.label}
            id={`deck-section-${def.id}`}
            onDragOver={(e) => {
              if (!accepts(e)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_ENTRY)
                ? 'move'
                : 'copy'
              if (over !== def.id) setOver(def.id)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              drop(e, def.id)
            }}
            className={cn(
              '-m-1.5 space-y-2 rounded-lg p-1.5 transition-colors',
              over === def.id && 'bg-chip/60 ring-2 ring-ring/60'
            )}
          >
            <h2 className={cn(SECTION_HEADING, 'tabular-nums')}>
              {`${def.label} ${count} / ${def.min}–${def.max}`}
            </h2>
            {entries.length === 0 ? (
              <p className="rounded-md border border-dashed border-white/15 px-3 py-4 text-center text-xs text-muted-foreground">
                {actions ? 'No cards yet. Drop cards here.' : 'No cards yet.'}
              </p>
            ) : (
              <ul
                className={cn(
                  'grid gap-1.5',
                  phone
                    ? 'grid-cols-5'
                    : 'grid-cols-5 sm:grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))]'
                )}
              >
                {entries.map((e) => (
                  <DeckGridTile
                    key={entryKey(e)}
                    entry={e}
                    card={cards[e.card]}
                    imageId={
                      (e.printing ? printingArt[e.printing] : undefined) ?? cards[e.card]?.imageId
                    }
                    have={have.get(entryKey(e)) ?? 0}
                    cover={cover === e.card}
                    highlight={highlight === entryKey(e)}
                    flag={flagged.get(e.card)}
                    actions={actions}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

function DeckGridTile({
  entry,
  card,
  imageId,
  have,
  cover,
  highlight,
  flag,
  actions
}: {
  entry: DeckEntry
  card: DeckCard | undefined
  imageId: number | null | undefined
  have: number
  cover: boolean
  highlight: boolean
  flag: 'error' | 'warning' | undefined
  actions?: EntryActions
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const key = entryKey(entry)
  const name = card?.name ?? `Card #${entry.card}`
  const need = Math.max(0, entry.qty - have)
  const face = (
    <>
      <div className={cn('transition-opacity', need > 0 && 'opacity-55')}>
        {imageId ? (
          <CardArt imageId={imageId} size="small" alt="" className="w-full rounded-[3px]" />
        ) : (
          <div className="flex aspect-[59/86] items-center justify-center rounded-[3px] bg-muted p-1 text-center text-[10px] leading-tight text-muted-foreground">
            {card ? name : unknownCardText(entry.card)}
          </div>
        )}
      </div>
      {need > 0 && <span className={cn(BADGE_PILL, 'left-1 top-1')}>{`need ${need}`}</span>}
      {entry.printing && (
        <span
          className={cn(BADGE_PILL, 'right-1 top-1 px-1')}
          title={`Pinned printing ${entry.printing}`}
        >
          <PinIcon aria-label="Pinned printing" className="my-[3px] size-3" />
        </span>
      )}
      {cover && (
        <span className={cn(BADGE_PILL, 'bottom-1 left-1 px-1')} title="Cover">
          <StarIcon aria-label="Cover" className="my-[3px] size-3" />
        </span>
      )}
      <span className={cn(BADGE_PILL, 'bottom-1 right-1')}>{`×${entry.qty}`}</span>
    </>
  )
  const ring = cn(
    'relative block w-full rounded-[5px] outline-none transition-shadow',
    flag === 'error' && 'ring-2 ring-destructive',
    flag === 'warning' && 'ring-2 ring-amber-400',
    highlight && 'ring-[3px] ring-primary ring-offset-2 ring-offset-background'
  )
  return (
    <li
      id={entryDomId(key)}
      aria-label={name}
      data-highlight={highlight ? 'true' : undefined}
      className="min-w-0"
    >
      {card && imageId && <span className="sr-only">{name}</span>}
      {actions ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${name} ×${entry.qty}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_ENTRY, key)
                e.dataTransfer.effectAllowed = 'move'
              }}
              className={cn(
                ring,
                'cursor-pointer hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring'
              )}
            >
              {face}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-3">
            <EntryPopover
              entry={entry}
              name={name}
              owned={card?.owned ?? 0}
              cover={cover}
              actions={actions}
              onPick={() => {
                setOpen(false)
                setPicking(true)
              }}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <div className={ring} title={name}>
          {face}
        </div>
      )}
      {picking && actions && (
        <PrintingPicker
          entry={entry}
          name={name}
          onPick={(p) => {
            setPicking(false)
            actions.onPin(entry, p)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </li>
  )
}

/** One entry's controls: copies, moving it, cover, printing and removing it. */
function EntryPopover({
  entry,
  name,
  owned,
  cover,
  actions,
  onPick
}: {
  entry: DeckEntry
  name: string
  owned: number
  cover: boolean
  actions: EntryActions
  onPick: () => void
}): React.JSX.Element {
  return (
    <>
      <div className="truncate text-sm font-semibold">{name}</div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={`Remove a copy of ${name}`}
          onClick={() => actions.onQty(entry, -1)}
        >
          <MinusIcon />
        </Button>
        <span
          aria-label="Copies in this section"
          className="w-6 text-center font-mono text-sm tabular-nums"
        >
          {entry.qty}
        </span>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={`Add a copy of ${name}`}
          onClick={() => actions.onQty(entry, 1)}
        >
          <PlusIcon />
        </Button>
        <span className="ml-auto rounded-full bg-chip px-2.5 py-1 font-mono text-xs tabular-nums">
          {`own ${owned}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {actions.sections
          .filter((s) => s.id !== entry.section)
          .map((s) => (
            <Button
              key={s.id}
              variant="secondary"
              size="xs"
              aria-label={`Move to ${s.label}`}
              onClick={() => actions.onMove(entry, s.id)}
            >
              {`→ ${s.label.replace(/ Deck$/, '')}`}
            </Button>
          ))}
        <Button
          variant="secondary"
          size="xs"
          aria-pressed={cover}
          onClick={() => actions.onCover(entry)}
        >
          <StarIcon className={cn(cover && 'fill-current')} />
          {cover ? 'Cover' : 'Use as cover'}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          aria-label={`Pin a printing of ${name}`}
          className={cn(entry.printing && 'text-primary')}
          onClick={onPick}
        >
          <PinIcon />
          {entry.printing ? 'Printing pinned' : 'Printing'}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="text-destructive"
          onClick={() => actions.onRemove(entry)}
        >
          Remove from deck
        </Button>
      </div>
    </>
  )
}
