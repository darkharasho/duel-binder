/**
 * DON!! cards, from TCGCSV alone: Bandai's English card list has none. As a Pokémon basic Energy
 * is, a DON!! card is a real card with versions: one card per TCGplayer product (one picture: a
 * set's DON!!, a character's, a gold one), and one version per finish TCGCSV prices it in
 * (`Normal` → `DON!!`, `Foil` → `DON!! (Foil)`), each priced from its own row. The card's id
 * and its printings' keys come from the product id and the finish, never from row order, so
 * they are the same every night.
 */
import type { TcPrice } from '../pokemon/types'
import { opTcgArtKey } from '../../../src/shared/imageSources'
import type { OpProduct } from './tcgcsv'
import { isDonProduct } from './versions'

export interface DonVersion {
  /** The printing's set_rarity_code: `tcg:<product id>/<subtype>`. */
  code: string
  /** The printing's set_rarity. */
  label: string
  price: number | null
}

export interface DonCard {
  productId: number
  /** The Bandai series whose set the card is written in. */
  seriesId: string
  name: string
  description: string | null
  versions: DonVersion[]
}

/** `DON!! Card (Gold)` → `DON!! (Gold)`: the card itself says DON!!. */
export const donName = (productName: string): string =>
  productName.trim().replace(/^DON!! Card\b/, 'DON!!')

/** A DON!! printing's key for a product and TCGCSV subtype. */
export const donCode = (productId: number, subType: string): string =>
  `${opTcgArtKey(productId)}/${subType}`

/**
 * Tonight's DON!! cards among `products`. A product with no picture yet, or no price row (so no
 * known finish), is held; one in a group no series takes is left out and named in `unplaced`.
 * `listed` is every DON!! product seen, held or not, so a stored one is only flagged missing
 * when TCGplayer stops listing it.
 */
export function donCards(
  products: OpProduct[],
  prices: TcPrice[],
  seriesOfGroup: (groupId: number) => string | undefined
): { cards: DonCard[]; listed: Set<number>; held: number; unplaced: number[] } {
  const rowsOf = new Map<number, TcPrice[]>()
  for (const r of prices) {
    const l = rowsOf.get(r.productId)
    if (l) l.push(r)
    else rowsOf.set(r.productId, [r])
  }
  const cards: DonCard[] = []
  const listed = new Set<number>()
  const unplaced: number[] = []
  let held = 0
  const dons = products.filter(isDonProduct).sort((a, b) => a.productId - b.productId)
  for (const p of dons) {
    listed.add(p.productId)
    const seriesId = seriesOfGroup(p.groupId)
    if (seriesId === undefined) {
      unplaced.push(p.productId)
      continue
    }
    const rows = rowsOf.get(p.productId) ?? []
    if (p.imageUrl === null || rows.length === 0) {
      held++
      continue
    }
    const bySub = new Map<string, TcPrice[]>()
    for (const r of rows) {
      const sub = r.subTypeName.trim()
      bySub.set(sub, [...(bySub.get(sub) ?? []), r])
    }
    const subs = [...bySub.keys()].sort((a, b) =>
      a === 'Normal' ? -1 : b === 'Normal' ? 1 : a.localeCompare(b, 'en')
    )
    cards.push({
      productId: p.productId,
      seriesId,
      name: donName(p.name),
      description: p.description ?? null,
      versions: subs.map((sub) => {
        const same = bySub.get(sub)!
        // Exactly one row is a price, as for every other One Piece product.
        return {
          code: donCode(p.productId, sub),
          label: sub === 'Normal' ? 'DON!!' : `DON!! (${sub})`,
          price: same.length === 1 ? same[0].marketPrice : null
        }
      })
    })
  }
  return { cards, listed, held, unplaced }
}
