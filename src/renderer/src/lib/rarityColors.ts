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
  'Gold Rare': '#d4a93c'
}

export function rarityColor(rarity: string): string {
  return RARITY_COLORS[rarity] ?? '#9ca3af'
}
