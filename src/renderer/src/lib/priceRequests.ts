import { useEffect } from 'react'
import type { Language } from '@shared/languages'
import type { SetChecklist } from '@shared/types'
import { api } from './api'

/** Waits this long after the printings on screen change, so paging through sets asks once. */
export const REQUEST_DELAY_MS = 1_000

/** The printing ids worth asking a price for: non-English with no price. */
export function unpricedIntl(
  printings: Iterable<{ printingId: number; language: Language; price: number | null | undefined }>
): number[] {
  const ids: number[] = []
  for (const p of printings) if (p.language !== 'en' && p.price == null) ids.push(p.printingId)
  return ids
}

/** A non-English checklist's printings of every rarity with no price, in checklist order; [] for English. */
export function checklistUnpriced(data: SetChecklist | null | undefined): number[] {
  if (!data || data.set.language === 'en') return []
  return data.cards.flatMap((c) =>
    c.rarities.filter((r) => r.price == null).flatMap((r) => r.codes.map((x) => x.printingId))
  )
}

/**
 * Asks for eBay prices for the unpriced printings on screen (see Api.prices.request), once they've
 * stayed on screen for REQUEST_DELAY_MS. Main skips English printings, priced ones and ones asked for
 * lately, so callers can pass whatever they show. Fire and forget.
 */
export function useRequestPrices(printingIds: readonly number[]): void {
  // In screen order: past the portal's per-request limit, what's shown first is asked for first.
  const key = [...new Set(printingIds)].join(',')
  useEffect(() => {
    if (key === '') return
    const ids = key.split(',').map(Number)
    const timer = setTimeout(() => {
      api.prices
        .ebayHidden()
        .then((hidden) => (hidden ? undefined : api.prices.request(ids)))
        .catch(() => {
          // Nothing to tell the user: the next view asks again.
        })
    }, REQUEST_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key])
}
