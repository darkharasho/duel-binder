/**
 * What a Gem Pack version the catalog calls only "Holofoil" shows, by set and the number's last two
 * digits. A Gem Pack prints each card in several versions, numbered apart (CBB7C 2501 to 2507),
 * and the catalog names only the patterns and the stamp; the rest are all Holofoil. Shown in place
 * of that name only: the catalog's stays the printing's key. Vol. 7's as the owner's cards show them;
 * the other volumes' slots haven't been checked.
 */
const HOLOFOIL_SLOTS: Record<string, Record<string, string>> = {
  CBB7C: { '01': 'Energy Symbol', '03': 'Glitter', '04': 'Sunburst', '07': 'Illustration Rare' }
}

/** The name to show for a printing's version: `rarity`, or a Gem Pack Holofoil's own. */
export function gemVersionName(setCode: string, rarity: string): string {
  if (rarity !== 'Holofoil') return rarity
  const [set, number] = setCode.split(' ')
  if (!number || number.length !== 4) return rarity
  return HOLOFOIL_SLOTS[set]?.[number.slice(2)] ?? rarity
}
