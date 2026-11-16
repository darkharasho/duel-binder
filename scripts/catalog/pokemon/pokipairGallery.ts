/**
 * PokiPair's older set pages (CSV1–CSV7, CSV9.5, most CS sets) are a plain gallery: "Card List 01"
 * to "391", no card numbers, each Common, Uncommon and Rare followed by its reverse prints (CSV1:
 * plain, Poké Ball, Master Ball), the higher rarities once. Its cards are told apart by their art:
 * neighbouring pictures with the same art are one card, the plain print first, and the cards come
 * in the set's order. A page is matched only when it splits into exactly as many cards as the set
 * has and which cards have reverses follows rarity, so a missing or extra card leaves the whole set
 * unmatched rather than every later card on its neighbour's art.
 */
import { artHash, hamming } from '../../../src/shared/scan/fingerprint'
import { crop, type Box } from '../../../src/shared/scan/regions'
import type { RgbaImage } from '../../../src/shared/scan/types'
import { decodeImage } from '../references'
import type { PpCard, ZhCatalogCard } from './pokipair'

/** The art window of a Scarlet & Violet or Sword & Shield card, as the scanner's (PKM_ART). */
const GALLERY_ART: Box = [0.1, 0.14, 0.9, 0.47]

/**
 * Neighbours this close (of 256 bits) are one card's prints. On CSV1 a card's prints sit within
 * 30 of each other, and neighbouring cards 110 or more apart.
 */
export const SAME_ART = 60

/**
 * Of a rarity's cards, the share that must agree on having reverse prints or not. A gallery read
 * one card off gives most rarities a mix.
 */
const RARITY_AGREEMENT = 0.9

/** The art hash of a gallery thumbnail, or null when it won't decode. */
export function galleryHash(bytes: Uint8Array): Uint32Array | null {
  let img: RgbaImage | null
  try {
    img = decodeImage(bytes)
  } catch {
    return null
  }
  if (!img || img.width < 16 || img.height < 16) return null
  return artHash(crop(img, GALLERY_ART))
}

/** Runs of neighbouring pictures with the same art, as indexes into the page. */
export function galleryGroups(hashes: readonly Uint32Array[]): number[][] {
  const groups: number[][] = []
  hashes.forEach((h, i) => {
    if (i > 0 && hamming(hashes[i - 1], 0, h, 0) <= SAME_ART) groups[groups.length - 1].push(i)
    else groups.push([i])
  })
  return groups
}

/** Whether a page is a gallery to match by art: no numbers, and more pictures than cards. */
export function isGallery(page: readonly PpCard[], cards: readonly ZhCatalogCard[]): boolean {
  return (
    cards.length > 0 &&
    page.length > cards.length &&
    page.every((c) => c.number === null && c.thumb)
  )
}

/**
 * Each card's plain picture on a gallery page, by source id; empty when the page won't line up.
 * `hashes` are the page's thumbnails' art hashes, in page order.
 */
export function matchGallery(
  page: readonly PpCard[],
  hashes: readonly Uint32Array[],
  cards: readonly ZhCatalogCard[]
): Map<string, string> {
  const out = new Map<string, string>()
  if (hashes.length !== page.length) return out
  const groups = galleryGroups(hashes)
  if (groups.length !== cards.length) return out
  const ordered = [...cards].sort((a, b) =>
    a.number.localeCompare(b.number, 'en', { numeric: true })
  )
  // Which cards have reverses follows rarity: each rarity mostly one way or the other.
  const byRarity = new Map<string, { many: number; all: number }>()
  ordered.forEach((c, i) => {
    const k = c.rarity ?? ''
    const r = byRarity.get(k) ?? { many: 0, all: 0 }
    r.all++
    if (groups[i].length > 1) r.many++
    byRarity.set(k, r)
  })
  for (const { many, all } of byRarity.values()) {
    const share = many / all
    if (share > 1 - RARITY_AGREEMENT && share < RARITY_AGREEMENT) return out
  }
  ordered.forEach((c, i) => out.set(c.sourceId, page[groups[i][0]].url))
  return out
}
