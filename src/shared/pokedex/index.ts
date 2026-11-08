import { SPECIES } from './species'

export { SPECIES }

export const POKEDEX_SIZE = 1025

export interface Generation {
  gen: number
  label: string
  region: string
  first: number
  last: number
}

export const GENERATIONS: readonly Generation[] = [
  { gen: 1, label: 'I', region: 'Kanto', first: 1, last: 151 },
  { gen: 2, label: 'II', region: 'Johto', first: 152, last: 251 },
  { gen: 3, label: 'III', region: 'Hoenn', first: 252, last: 386 },
  { gen: 4, label: 'IV', region: 'Sinnoh', first: 387, last: 493 },
  { gen: 5, label: 'V', region: 'Unova', first: 494, last: 649 },
  { gen: 6, label: 'VI', region: 'Kalos', first: 650, last: 721 },
  { gen: 7, label: 'VII', region: 'Alola', first: 722, last: 809 },
  { gen: 8, label: 'VIII', region: 'Galar', first: 810, last: 905 },
  { gen: 9, label: 'IX', region: 'Paldea', first: 906, last: 1025 }
]

const valid = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= POKEDEX_SIZE

export function speciesName(n: number): string | null {
  return valid(n) ? SPECIES[n - 1] : null
}

export function generationOf(n: number): number | null {
  if (!valid(n)) return null
  return GENERATIONS.find((g) => n >= g.first && n <= g.last)?.gen ?? null
}
