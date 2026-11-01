import type { TdCard, TdSet, TdVariant } from './types'
import { GENERATED_VARIANT_ID } from './versions'

/**
 * English-language sets neither TCGdex's English list nor TCGplayer has as such: the cards a Dex
 * export holds, as it prints them. Not whole sets, and no art or price. France's 2018 McDonald's
 * set is English to Dex but only TCGdex's French list has it, so its id is that list's.
 */
const SETS = [
  {
    id: 'ba20m',
    name: 'Battle Academy 2020: Mewtwo Deck',
    serie: 'swsh',
    official: 17,
    cards: [
      { localId: '6', name: 'Mew', rarity: 'Rare', illustrator: 'Atsuko Nishida', finishes: ['normal'] }
    ]
  },
  {
    id: '2018sm-fr',
    name: "McDonald's Collection 2018 (France)",
    serie: 'sm',
    official: 40,
    cards: [
      { localId: '11', name: 'Poliwag', rarity: null, illustrator: 'Asako Ito', finishes: ['normal', 'reverse'] }
    ]
  }
]

export function dexSets(): { set: TdSet; cards: TdCard[] }[] {
  return SETS.map(({ id, name, serie, official, cards: held }) => {
    const ref = { id, name }
    const cards = held.map(
      ({ finishes, ...card }): TdCard => ({
        ...card,
        id: `${id}-${card.localId}`,
        category: 'Pokemon',
        variants_detailed: finishes.map(
          (type): TdVariant => ({ type, variantId: GENERATED_VARIANT_ID })
        ),
        set: ref
      })
    )
    return {
      set: {
        ...ref,
        serie: { id: serie },
        cardCount: { official, total: cards.length },
        cards: cards.map((c) => ({ id: c.id, localId: c.localId, name: c.name }))
      },
      cards
    }
  })
}
