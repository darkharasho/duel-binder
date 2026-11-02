/**
 * A Pokémon card's rarity as the catalog writes it (`pokemon_cards.rarity`): TCGdex spells one
 * rarity several ways ("Triple rare" and "Triple Rare", "Rare Holo" and "Holo Rare"), so the
 * filter would list each twice. Words take title case, and a word with no lower case letter is a
 * token kept as it is (ACE SPEC, V, VMAX, VSTAR, LV.X, PRIME, LEGEND, RGB). "None", which is how
 * TCGdex writes no rarity, is no rarity, like an empty one.
 * Only the written value changes; the catalog's own matching reads the source's spelling.
 */
export function pokemonRarity(raw: string | null | undefined): string | null {
  const words = (raw ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const name = words.map((w) => (/\p{Ll}/u.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
  if (name === 'None') return null
  // "Rare Holo" is the older name of "Holo Rare", as in "Holo Rare V".
  return name.replace(/^Rare Holo\b/, 'Holo Rare')
}
