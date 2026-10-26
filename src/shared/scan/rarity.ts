/** Lowest to highest. Variants like "Ultra Rare (Extended Art)" rank just after their base. */
export const RARITY_TIERS: readonly string[] = [
  'Common',
  'Short Print',
  'Super Short Print',
  'Rare',
  'Super Rare',
  'Ultra Rare',
  'Ultimate Rare',
  'Secret Rare',
  'Ghost Rare',
  'Gold Rare',
  'Prismatic Secret Rare',
  'Starlight Rare',
  'Quarter Century Secret Rare'
]

export function rarityRank(r: string): number {
  const exact = RARITY_TIERS.indexOf(r)
  if (exact !== -1) return exact
  const base = RARITY_TIERS.indexOf(r.replace(/\s*\(.*\)\s*$/, ''))
  return base !== -1 ? base + 0.5 : RARITY_TIERS.length
}

/** The rarity to add for a printing; `certain` is false when we had to guess. */
export function pickRarity(
  available: string[],
  preferred: string | null
): { rarity: string; certain: boolean } {
  const distinct = [...new Set(available)]
  if (distinct.length === 1) return { rarity: distinct[0], certain: true }
  if (preferred !== null && distinct.includes(preferred))
    return { rarity: preferred, certain: true }
  const lowest = distinct.sort((a, b) => rarityRank(a) - rarityRank(b))[0] ?? ''
  return { rarity: lowest, certain: false }
}
