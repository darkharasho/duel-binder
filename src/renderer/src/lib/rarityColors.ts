// Rarities keep colours a collector would expect; anything else falls back to grey.
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

export function rarityColor(rarity: string): string {
  return RARITY_COLORS[rarity] ?? '#9ca3af'
}

/** Dark or white text, whichever reads better on the rarity's colour. */
export function rarityTextColor(rarity: string): string {
  const hex = rarityColor(rarity).slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 140 ? '#18181b' : '#ffffff'
}
