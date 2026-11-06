import type { GameId } from '@shared/games'
import type { PlaceholderCard } from '@shared/placeholders'
import type { BinderCard } from '@shared/types'

/** The set code a printing's number starts with ("LOB" of "LOB-EN001", "DLR" of "DLR 011/103"). */
const codeOf = (setCode: string): string => setCode.split(/[\s-]/)[0] ?? ''

/**
 * One pocket per slot, in the order given. A printing slot names its set, number and rarity (a
 * Pokémon printing's rarity is its finish); a card or art slot, which any printing fills, names the
 * binder instead.
 */
export function binderPlaceholders(cards: readonly BinderCard[], game: GameId): PlaceholderCard[] {
  return cards.map((c) => {
    const p = c.printing
    const pokemon = game === 'pkm'
    return {
      imageId: c.imageId,
      name: c.card.name,
      number: p?.setCode ?? '',
      rarity: (pokemon ? c.card.pokemon?.rarity : p?.setRarity) ?? null,
      finish: pokemon && p ? p.setRarity : null,
      setName: p?.setName ?? null,
      setCode: p ? codeOf(p.setCode) : null
    }
  })
}
