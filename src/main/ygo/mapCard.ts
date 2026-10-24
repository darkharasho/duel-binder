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

export function mapApiCard(
  c: ApiCard,
  _now: string
): {
  card: CardRow
  printings: Omit<Printing, 'id' | 'missingFromApi'>[]
  images: CardImage[]
} {
  return {
    card: {
      id: c.id,
      name: c.name,
      type: c.type,
      frameType: c.frameType,
      race: c.race,
      attribute: c.attribute ?? null,
      level: c.level ?? null,
      linkval: c.linkval ?? null,
      atk: c.atk ?? null,
      def: c.def ?? null,
      archetype: c.archetype ?? null,
      desc: c.desc,
      tcgplayerPrice: parsePrice(c.card_prices?.[0]?.tcgplayer_price)
    },
    printings: (c.card_sets ?? []).map((s) => ({
      cardId: c.id,
      setName: s.set_name,
      setCode: s.set_code,
      setRarity: s.set_rarity,
      setRarityCode: s.set_rarity_code ?? '',
      setPrice: parsePrice(s.set_price)
    })),
    images: (c.card_images ?? []).map((img, i) => ({
      imageId: img.id,
      cardId: c.id,
      sortOrder: i
    }))
  }
}
