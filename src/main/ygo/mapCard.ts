import { parsePrice } from '@shared/pricing'
import type { CardImage, CardRow, Printing } from '@shared/types'

export interface ApiCard {
  id: number
  name: string
  type: string
  frameType: string
  desc: string
  race: string
  atk?: number
  def?: number
  level?: number
  linkval?: number
  attribute?: string
  archetype?: string
  card_sets?: {
    set_name: string
    set_code: string
    set_rarity: string
    set_rarity_code?: string
    set_price?: string
  }[]
  card_images: { id: number }[]
  card_prices?: { tcgplayer_price?: string }[]
}

type ApiSet = NonNullable<ApiCard['card_sets']>[number]

/**
 * A printing YGOPRODeck copied wrongly from Yugipedia, and the rarities it really comes in. Its
 * RA05-EN136 rarity is the wiki list's `force-SMW` directive; the variant art pool it's in is Ultra
 * and Starlight Rare.
 */
const RARITY_FIXES: Record<string, { rarity: string; code: string }[]> = {
  'RA05-EN136|force-SMW': [
    { rarity: 'Ultra Rare', code: '(UR)' },
    { rarity: 'Starlight Rare', code: '(StR)' }
  ]
}

const fixRarity = (s: ApiSet): ApiSet[] =>
  RARITY_FIXES[`${s.set_code}|${s.set_rarity}`]?.map((f) => ({
    ...s,
    set_rarity: f.rarity,
    set_rarity_code: f.code
  })) ?? [s]

export function mapApiCard(
  c: ApiCard,
  _now: string
): {
  card: CardRow
  printings: Omit<Printing, 'id' | 'missingFromApi' | 'language'>[]
  images: CardImage[]
} {
  return {
    card: {
      id: c.id,
      name: c.name,
      type: c.type ?? '',
      frameType: c.frameType ?? '',
      race: c.race ?? '',
      attribute: c.attribute ?? null,
      level: c.level ?? null,
      linkval: c.linkval ?? null,
      atk: c.atk ?? null,
      def: c.def ?? null,
      archetype: c.archetype ?? null,
      desc: c.desc ?? '',
      tcgplayerPrice: parsePrice(c.card_prices?.[0]?.tcgplayer_price)
    },
    printings: (c.card_sets ?? []).flatMap(fixRarity).map((s) => ({
      cardId: c.id,
      setName: s.set_name,
      setCode: s.set_code,
      setRarity: s.set_rarity,
      setRarityCode: s.set_rarity_code ?? '',
      setPrice: parsePrice(s.set_price)
    })),
    images: (c.card_images ?? []).filter((img) => Number.isInteger(img?.id)).map((img, i) => ({
      imageId: img.id,
      cardId: c.id,
      sortOrder: i
    }))
  }
}
