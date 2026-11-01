import type { TdCard, TdSet, TdVariant } from './types'
import { GENERATED_VARIANT_ID } from './versions'

/**
 * Simplified Chinese promos. The Chinese list's PROMO file is empty and no source we may use has
 * them, so these are the cards a Dex export holds, as it prints them: not whole sets, and no art.
 * The ids meet Dex's at `scn_30thp` and `scn_svp` (see dexCode in shared/dex/match).
 */
interface Promo {
  localId: string
  name: string
  illustrator: string
  finish: string
}

const SETS: { id: string; name: string; serie: string; official: number; cards: Promo[] }[] = [
  {
    id: '30thPC',
    name: '30th Celebration Promos',
    serie: 'Mega',
    official: 9,
    cards: [
      { localId: '022', name: 'Grookey', illustrator: 'Saboteri', finish: 'holo' },
      { localId: '023', name: 'Scorbunny', illustrator: 'Saboteri', finish: 'holo' },
      { localId: '024', name: 'Sobble', illustrator: 'Saboteri', finish: 'holo' }
    ]
  },
  {
    id: 'SVPC',
    name: 'Scarlet & Violet Promos',
    serie: 'Scarlet & Violet',
    official: 49,
    cards: [
      { localId: '131', name: 'Darumaka', illustrator: 'Miki Tanaka', finish: 'Poke Ball Pattern' },
      { localId: '133', name: 'Remoraid', illustrator: 'Midori Harada', finish: 'normal' }
    ]
  }
]

export function chinesePromoSets(): { set: TdSet; cards: TdCard[] }[] {
  return SETS.map(({ id, name, serie, official, cards: promos }) => {
    const ref = { id, name }
    const cards = promos.map(
      (p): TdCard => ({
        id: `${id}-${p.localId}`,
        localId: p.localId,
        name: p.name,
        category: 'Pokemon',
        rarity: 'Promo',
        illustrator: p.illustrator,
        variants_detailed: [{ type: p.finish, variantId: GENERATED_VARIANT_ID } as TdVariant],
        set: ref
      })
    )
    return {
      set: {
        ...ref,
        serie: { id: serie },
        abbreviation: { official: id },
        cardCount: { official, total: cards.length },
        cards: cards.map((c) => ({ id: c.id, localId: c.localId, name: c.name }))
      },
      cards
    }
  })
}
