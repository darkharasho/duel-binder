/**
 * Normalizes a raw price from the YGOPRODeck API. Returns null for missing,
 * non-numeric, non-finite, or non-positive values (e.g. "0.00", "", "N/A").
 */
export function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const n = typeof raw === 'number' ? raw : Number(raw.trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Picks the unit price for a printing: the set price (USD) when present,
 * otherwise the TCGplayer price, which is marked approximate.
 */
export function priceFor(
  setPrice: number | null,
  tcgplayerPrice: number | null
): { unitPrice: number | null; approximate: boolean } {
  const set = parsePrice(setPrice)
  if (set !== null) return { unitPrice: set, approximate: false }
  return { unitPrice: parsePrice(tcgplayerPrice), approximate: true }
}
