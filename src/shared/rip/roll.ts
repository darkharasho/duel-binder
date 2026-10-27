import { baseOf } from './rarity'
import type { PackLayout, PackSlot, PoolCard, RipCard } from './types'

/** Small seeded PRNG (mulberry32). Returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Base rarity → card id → that card's printings at the rarity (alt arts, Overframe…). */
type RarityIndex = Map<string, Map<number, PoolCard[]>>

/** Group a pool by base rarity, so "Ultra Rare (Overframe)" counts as an Ultra Rare. */
function indexPool(pool: PoolCard[]): RarityIndex {
  const index: RarityIndex = new Map()
  for (const card of pool) {
    const base = baseOf(card.rarity)
    let cards = index.get(base)
    if (!cards) index.set(base, (cards = new Map()))
    const printings = cards.get(card.cardId)
    if (printings) printings.push(card)
    else cards.set(card.cardId, [card])
  }
  return index
}

/** True when every slot's base rarity has at least one card in the pool. */
export function canFill(layout: PackLayout, pool: PoolCard[]): boolean {
  const index = indexPool(pool)
  return layout.slots.every((slot) => (index.get(baseOf(slot.picks[0].rarity))?.size ?? 0) > 0)
}

const pickIndex = (n: number, rand: () => number): number => Math.min(n - 1, Math.floor(rand() * n))

/** Pick a rarity for one card of a slot; picks missing from the pool give their weight to `picks[0]`. */
function pickRarity(slot: PackSlot, index: RarityIndex, rand: () => number): string {
  const base = baseOf(slot.picks[0].rarity)
  const live: { rarity: string; weight: number }[] = [{ rarity: base, weight: 0 }]
  for (const pick of slot.picks) {
    const rarity = baseOf(pick.rarity)
    const target = index.has(rarity) ? live.find((l) => l.rarity === rarity) : live[0]
    if (target) target.weight += pick.weight
    else live.push({ rarity, weight: pick.weight })
  }
  const total = live.reduce((sum, l) => sum + l.weight, 0)
  let roll = rand() * total
  for (const l of live) {
    roll -= l.weight
    if (roll < 0) return l.rarity
  }
  return live[live.length - 1].rarity
}

/**
 * Roll one pack. Each slot picks a rarity by weight, then a card uniformly by card id, then one of
 * that card's printings at the rarity uniformly. A card doesn't repeat within a slot unless its
 * rarity has run out of other cards. Throws when a slot's base rarity has no cards (see `canFill`).
 */
export function rollPack(layout: PackLayout, pool: PoolCard[], rand: () => number): RipCard[] {
  const index = indexPool(pool)
  const pack: RipCard[] = []
  for (const slot of layout.slots) {
    if (!index.has(baseOf(slot.picks[0].rarity))) {
      throw new Error(`No ${slot.picks[0].rarity} cards to fill layout ${layout.id}`)
    }
    const used = new Set<number>()
    for (let i = 0; i < slot.count; i++) {
      const cards = index.get(pickRarity(slot, index, rand))!
      const ids = [...cards.keys()]
      const fresh = ids.filter((id) => !used.has(id))
      const choices = fresh.length > 0 ? fresh : ids
      const cardId = choices[pickIndex(choices.length, rand)]
      used.add(cardId)
      const printings = cards.get(cardId)!
      pack.push({ ...printings[pickIndex(printings.length, rand)], slot: pack.length })
    }
  }
  return pack
}
