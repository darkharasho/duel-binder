import type { GameId } from '@shared/games'

// Yu-Gi-Oh!'s rarities keep colours a collector would expect; anything else falls back to grey.
export const RARITY_COLORS: Record<string, string> = {
  'Ultra Rare': '#e9c46a',
  'Secret Rare': '#c8b6ff',
  'Super Rare': '#8ab4f8',
  Rare: '#d9d6cf',
  Common: '#6d6b67',
  'Short Print': '#8f8d88',
  'Super Short Print': '#a8a59f',
  'Ghost Rare': '#b9e3ef',
  'Starlight Rare': '#f3d9a4',
  'Prismatic Secret Rare': '#f0b4d0',
  'Quarter Century Secret Rare': '#e6a96b',
  'Ultimate Rare': '#c9a35c',
  'Gold Rare': '#d4a93c',
  'Premium Gold Rare': '#e3b94f',
  'Gold Secret Rare': '#f1d27a',
  'Ghost/Gold Rare': '#ddd3a8'
}

// Pokémon's printing versions: the foils get a colour, Normal and the rest stay grey. Yu-Gi-Oh! has
// no foil colour of its own, so Holofoil takes the gold of its Gold Rare.
const HOLO = '#d4a93c'
const POKEMON_COLORS: Record<string, string> = {
  Holofoil: HOLO,
  '1st Edition Holofoil': HOLO,
  'Reverse Holofoil': '#8fb4cf'
}

/** A game's rarity colours (exact labels). */
export const rarityColors = (game: GameId): Record<string, string> =>
  game === 'ygo' ? RARITY_COLORS : POKEMON_COLORS

/** A Pokémon version with its subtype in front ("Shadowless Holofoil") takes its base version's colour. */
function pokemonColor(version: string): string | undefined {
  if (POKEMON_COLORS[version]) return POKEMON_COLORS[version]
  const base = Object.keys(POKEMON_COLORS)
    .filter((v) => version.endsWith(` ${v}`))
    .sort((a, b) => b.length - a.length)[0]
  return base && POKEMON_COLORS[base]
}

export function rarityColor(rarity: string, game: GameId = 'ygo'): string {
  const own = game === 'ygo' ? RARITY_COLORS[rarity] : pokemonColor(rarity)
  return own ?? '#9ca3af'
}

/** Dark or white text, whichever reads better on the rarity's colour. */
export function rarityTextColor(rarity: string, game: GameId = 'ygo'): string {
  const hex = rarityColor(rarity, game).slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 140 ? '#18181b' : '#ffffff'
}
