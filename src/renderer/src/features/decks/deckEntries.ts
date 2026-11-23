import type { DeckProblem } from '@shared/decks/check'
import { MAX_ENTRY_QTY } from '@shared/decks/fields'
import type { DeckCard, DeckEntry, DeckSection } from '@shared/decks/types'
import type { BrowseCard } from '@shared/types'

/** The verdict badge's colour by status. */
export const BADGE: Record<string, string> = {
  legal: 'text-complete',
  warnings: 'text-amber-500',
  illegal: 'text-destructive',
  unknown: 'text-muted-foreground',
  update: 'text-muted-foreground'
}

/** One entry's identity within a deck: its section, card and pinned printing. */
export const entryKey = (e: Pick<DeckEntry, 'section' | 'card' | 'printing'>): string =>
  `${e.section}:${e.card}:${e.printing ?? ''}`
export const entryDomId = (key: string): string => `deck-entry-${key.replace(/[^\w-]/g, '_')}`

/** One more copy of the card in the section, on its unpinned entry. */
export function addEntry(cards: DeckEntry[], card: number, section: DeckSection): DeckEntry[] {
  const key = entryKey({ section, card })
  if (cards.some((e) => entryKey(e) === key))
    return cards.map((e) =>
      entryKey(e) === key ? { ...e, qty: Math.min(MAX_ENTRY_QTY, e.qty + 1) } : e
    )
  return [...cards, { section, card, qty: 1 }]
}

/** A copy more or less; the last copy taken removes the entry. */
export function changeQty(cards: DeckEntry[], entry: DeckEntry, delta: 1 | -1): DeckEntry[] {
  const key = entryKey(entry)
  return cards.flatMap((e) => {
    if (entryKey(e) !== key) return [e]
    const qty = Math.min(MAX_ENTRY_QTY, e.qty + delta)
    return qty < 1 ? [] : [{ ...e, qty }]
  })
}

export function removeEntry(cards: DeckEntry[], entry: DeckEntry): DeckEntry[] {
  const key = entryKey(entry)
  return cards.filter((e) => entryKey(e) !== key)
}

/** Pins a printing (or none); an entry it now matches takes its copies. */
export function pinEntry(
  cards: DeckEntry[],
  entry: DeckEntry,
  printing: string | undefined
): DeckEntry[] {
  const from = entryKey(entry)
  const moved: DeckEntry = {
    section: entry.section,
    card: entry.card,
    ...(printing ? { printing } : {}),
    qty: entry.qty
  }
  const to = entryKey(moved)
  if (from === to) return cards
  const rest = cards.filter((e) => entryKey(e) !== from)
  if (rest.some((e) => entryKey(e) === to))
    return rest.map((e) =>
      entryKey(e) === to ? { ...e, qty: Math.min(MAX_ENTRY_QTY, e.qty + moved.qty) } : e
    )
  return cards.map((e) => (entryKey(e) === from ? moved : e))
}

/** Moves an entry to another section; an entry already there with its card and pin takes its copies. */
export function moveEntry(cards: DeckEntry[], entry: DeckEntry, section: DeckSection): DeckEntry[] {
  const from = entryKey(entry)
  const moved: DeckEntry = { ...entry, section }
  const to = entryKey(moved)
  if (from === to) return cards
  const rest = cards.filter((e) => entryKey(e) !== from)
  if (rest.some((e) => entryKey(e) === to))
    return rest.map((e) =>
      entryKey(e) === to ? { ...e, qty: Math.min(MAX_ENTRY_QTY, e.qty + entry.qty) } : e
    )
  return cards.map((e) => (entryKey(e) === from ? moved : e))
}

/** A card the deck holds that this device's catalog doesn't have (yet). */
export const unknownCardText = (id: number): string => `Card #${id} isn't in the catalog here yet`

/** What a newer list changed, short: its first new problem and how many more. */
export function changeSummary(added: DeckProblem[]): string | null {
  if (added.length === 0) return null
  return added.length === 1 ? added[0].message : `${added[0].message} and ${added.length - 1} more`
}

/** The owned copies of each card shared out over its entries in display order, by entryKey. */
export function shareOwned(
  shown: DeckEntry[],
  facts: Record<number, DeckCard>
): Map<string, number> {
  const left = new Map<number, number>()
  const out = new Map<string, number>()
  for (const e of shown) {
    const owned = left.get(e.card) ?? facts[e.card]?.owned ?? 0
    const got = Math.min(owned, e.qty)
    left.set(e.card, owned - got)
    out.set(entryKey(e), got)
  }
  return out
}

/** What the deck needs of a search result, until the deck's own read brings the full facts. */
export function deckCardOf(c: BrowseCard): DeckCard {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    frameType: c.frameType,
    imageId: c.imageId,
    owned: c.owned,
    price: c.price,
    regionPrice: null,
    sourceId: null,
    code: null,
    opNumber: null,
    opCardType: null,
    opColors: [],
    opCost: null,
    opBlock: null
  }
}

/** Drag data: a card from the adder's results (a DeckCard as JSON), or a deck entry (its entryKey). */
export const DRAG_CARD = 'application/x-duel-binder-deck-card'
export const DRAG_ENTRY = 'application/x-duel-binder-deck-entry'

/** Mono uppercase, like the sidebar's group headings. */
export const SECTION_HEADING = 'font-mono text-[10.5px] font-medium uppercase tracking-[1.5px]'

/** A chip in the deck page's header rows: mono, rounded, on the wash. */
export const CHIP =
  'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-chip px-3 font-mono text-xs'
