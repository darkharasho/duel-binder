import type { EntryView, Printing } from '@shared/types'
import type { Language } from '@shared/languages'

/** One line of a card's panel: a printing, with the collection entry on it when there is one. */
export interface CardTypeRow {
  /** Stays the same when a printing's first copy is added, so the row keeps its focus. */
  key: string
  printing: Printing
  entry?: EntryView
  /**
   * Whether the row's −/+ goes through `sets.adjust`, which adds to the printing's original-art
   * entry (see adjustPrinting). A row of other art, or one of several on a printing, wouldn't be
   * the entry that changes, so its −/+ edits its own entry instead.
   */
  viaPrinting: boolean
}

export interface CardTypeOptions {
  printings: Printing[]
  copies: EntryView[]
  /** The card's original art; undefined until the card's details load. */
  originalImageId: number | undefined
  /** Printings owned when the panel opened. Listed first, and not re-sorted by an add. */
  ownedAtOpen: ReadonlySet<number>
  /** The set the panel was opened from, listed next. */
  preferSet?: { setName: string; language: Language }
  /** The printing of the tile opened in that set, first of the set's. */
  openedPrintingId?: number | null
}

/**
 * Every type of a card for its side panel, owned or not. A printing the catalog has retired
 * (`missingFromApi`: a finish that doesn't exist, a junk rarity) is listed only while the user has
 * a copy on it, like the Add Card dialog. Each entry gets its own row: a printing can hold several
 * (the scanner keeps a different art apart), and each is edited on its own.
 */
export function cardTypeRows({
  printings,
  copies,
  originalImageId,
  ownedAtOpen,
  preferSet,
  openedPrintingId
}: CardTypeOptions): CardTypeRow[] {
  const entries = new Map<number, EntryView[]>()
  for (const c of copies) entries.set(c.printing.id, [...(entries.get(c.printing.id) ?? []), c])
  const listed = printings.filter((p) => !p.missingFromApi || entries.has(p.id))
  // An entry's own printing can be one the card's list leaves out (a contributed one).
  const known = new Set(listed.map((p) => p.id))
  const own = copies
    .map((c) => c.printing)
    .filter((p, i, all) => !known.has(p.id) && all.findIndex((x) => x.id === p.id) === i)
  const rank = (p: Printing): number => {
    if (ownedAtOpen.has(p.id)) return 0
    if (preferSet && p.setName === preferSet.setName && p.language === preferSet.language) return 1
    return p.language === 'en' ? 2 : 3
  }
  return [...listed, ...own]
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        rank(a.p) - rank(b.p) ||
        (preferSet
          ? Number(b.p.id === openedPrintingId) - Number(a.p.id === openedPrintingId)
          : 0) ||
        a.i - b.i
    )
    .flatMap(({ p }): CardTypeRow[] => {
      const onIt = entries.get(p.id) ?? []
      if (onIt.length === 0) return [{ key: `p${p.id}`, printing: p, viaPrinting: true }]
      return onIt.map((entry, i) => ({
        key: i === 0 ? `p${p.id}` : `e${entry.id}`,
        printing: p,
        entry,
        viaPrinting: onIt.length === 1 && entry.imageId === originalImageId
      }))
    })
}
