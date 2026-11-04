import { useQuery } from '@tanstack/react-query'
import { printingNoun } from '@shared/games'
import type { GameId } from '@shared/games/types'
import type { ScanDraft } from '@shared/scan/types'
import { api, queryKeys } from '@/lib/api'

/** A scan's copies in the collection: of its printing, and of the card's other printings. */
export interface Owned {
  copies: number
  others: number
}

/** What a scan is, as far as the scanner knows: a printing, or null when that's still unsure. */
export const surePrinting = (d: Pick<ScanDraft, 'flag' | 'printingId'>): number | null =>
  d.flag === 'pick-printing' || d.flag === 'check-rarity' ? null : d.printingId

/** Copies of `d` on the scan list; of any printing of its card while `d`'s is unsure. */
export function copiesOnList(
  rows: (Pick<ScanDraft, 'game' | 'cardId' | 'printingId'> & { quantity: number })[],
  d: Pick<ScanDraft, 'game' | 'cardId' | 'flag' | 'printingId'>
): number {
  const printing = surePrinting(d)
  return rows
    .filter(
      (r) =>
        (r.game ?? 'ygo') === (d.game ?? 'ygo') &&
        r.cardId === d.cardId &&
        (printing === null || r.printingId === printing)
    )
    .reduce((n, r) => n + r.quantity, 0)
}

/**
 * Reads the collection for a card, any condition. With no sure printing every copy counts, so an
 * unsure scan never calls a card new that's owned in another printing. Null while loading.
 */
export function useOwned(
  cardId: number,
  printingId: number | null,
  options: { fresh?: boolean } = {}
): Owned | null {
  const entries = useQuery({
    queryKey: queryKeys.forCard(cardId),
    queryFn: () => api.collection.forCard(cardId),
    // The scan window has its own query cache, which the main window's Add can't invalidate.
    ...(options.fresh ? { staleTime: 0, gcTime: 0 } : {})
  })
  if (!entries.data) return null
  const owned = { copies: 0, others: 0 }
  for (const e of entries.data) {
    if (printingId === null || e.printing.id === printingId) owned.copies += e.quantity
    else owned.others += e.quantity
  }
  return owned
}

/** True for a card with no copy in the collection in any printing. */
export const isNewCard = (o: Owned): boolean => o.copies === 0 && o.others === 0

/**
 * "New card", "New printing · Own 2 others" or "Own 3", then how many of it this scan has when
 * that's more than this one.
 */
export function ownedText(o: Owned, scanned: number, game: GameId = 'ygo'): string {
  const others = o.others === 1 ? 'Own 1 other' : `Own ${o.others} others`
  const own =
    o.copies > 0
      ? `Own ${o.copies}`
      : o.others > 0
        ? `New ${printingNoun(game)} · ${others}`
        : 'New card'
  return scanned > 1 ? `${own} · ×${scanned} this scan` : own
}
