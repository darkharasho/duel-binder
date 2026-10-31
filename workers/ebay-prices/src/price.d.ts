// Types for the two helpers the portal's Pokémon sweep shares with this Worker.
export function isSingleCard(title: string): boolean
export function keptPrices(prices: number[]): number[]
export function askingPrice(prices: number[]): { price: number | null; listingCount: number }
