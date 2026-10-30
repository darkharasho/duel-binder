import { HASH_WORDS } from './fingerprint'

// The fingerprint refs file, beside the fingerprint file (fingerprintFile.ts), whose format older
// apps parse and so never changes. It says which printings each printing scan in the fingerprint
// file shows, so a photo that matches an overframe scan better than its card art can be taken for
// the overframe printing:
//
//   { "v": 1, "refs": [{ "h": "<64 hex>", "imageId": 123, "printings": ["<pkey>", ...] }] }
//
// `h` is the scan's record's hash bytes as the fingerprint file holds them (hashHex), so a refs
// file that doesn't go with the fingerprint file a client has simply matches nothing. Printings
// are named by their natural key (card_printings.pkey), since printing ids differ between the
// catalog job, the portal and each app. Only art variants (isArtVariant) are listed.

const VERSION = 1
/** Most refs a file may hold, and the longest printing key, so a bad upload can't be huge. */
const MAX_REFS = 50_000
const MAX_KEY_LENGTH = 300
const HEX = /^[0-9a-f]{64}$/

export interface FingerprintRef {
  h: string
  imageId: number
  /** card_printings.pkey of each printing the scan shows. */
  printings: string[]
}

export interface FingerprintRefsFile {
  v: typeof VERSION
  refs: FingerprintRef[]
}

/** A ref with its printings as this app's printing ids, the ones its catalog has. */
export interface ScanRef {
  h: string
  imageId: number
  printingIds: number[]
}

/** A reference scan an artwork matched, and how far off it was. */
export interface RefMatch {
  h: string
  printingIds: number[]
  distance: number
}

/** Variants that only change the foil colour of the name, not the art. */
const COLOUR = /^(red|blue|green|purple|silver|bronze|gold|yellow|orange|white|pink)$/i

/**
 * Variants that name an edition, foil or stamp of the usual art rather than another art ("Ultra
 * Rare (25th Anniversary Edition)", "Ultra Rare (Pharaoh's Rare)"): their scans can match a
 * photo better than YGOPRODeck's crop of the same art (taken for these on the owner's LC01
 * photos), so they never pick a printing out.
 */
const NOT_ART =
  /edition$|pharaoh's rare|^stamp$|promo|qualifier|date reprint|^replica$|^(chinese|english)$/i

/**
 * The variant a printing names, in its variant or in brackets after its rarity ("Ultra Rare
 * (Overframe)"), when it is more than a foil colour; null for none.
 */
export function namedVariant(rarity: string, variant: string | null | undefined): string | null {
  const named = variant?.trim() || /\(([^()]+)\)\s*$/.exec(rarity)?.[1]?.trim()
  return named && !COLOUR.test(named) ? named : null
}

/**
 * The art variant a printing is printed in, in lower case ("overframe"): an alternate, overframe
 * or manga art (namedVariant), and not an edition or foil of the usual art (NOT_ART). Null for
 * the card's usual art.
 */
export function artVariantName(rarity: string, variant: string | null | undefined): string | null {
  const named = namedVariant(rarity, variant)
  return named && !NOT_ART.test(named) ? named.toLowerCase() : null
}

/** Whether a printing's art differs from its card's usual art (see artVariantName). */
export const isArtVariant = (rarity: string, variant: string | null | undefined): boolean =>
  artVariantName(rarity, variant) !== null

/** The hash as the fingerprint file stores it (little-endian words), in lowercase hex. */
export function hashHex(hash: Uint32Array): string {
  let out = ''
  for (let w = 0; w < HASH_WORDS; w++) {
    for (let b = 0; b < 4; b++) out += ((hash[w] >>> (b * 8)) & 0xff).toString(16).padStart(2, '0')
  }
  return out
}

export function encodeFingerprintRefs(
  entries: { imageId: number; hash: Uint32Array; printings: string[] }[]
): Uint8Array {
  const file: FingerprintRefsFile = {
    v: VERSION,
    refs: entries.map((e) => ({ h: hashHex(e.hash), imageId: e.imageId, printings: e.printings }))
  }
  return new TextEncoder().encode(JSON.stringify(file))
}

/** The refs file in text, checked field by field; throws when it isn't one. */
export function parseFingerprintRefs(text: string): FingerprintRefsFile {
  const bad = (): never => {
    throw new Error('Not a fingerprint refs file')
  }
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return bad()
  }
  const f = file as Partial<FingerprintRefsFile> | null
  if (!f || f.v !== VERSION || !Array.isArray(f.refs) || f.refs.length > MAX_REFS) return bad()
  const refs = f.refs.map((r: Partial<FingerprintRef> | null): FingerprintRef => {
    if (
      !r ||
      typeof r.h !== 'string' ||
      !HEX.test(r.h) ||
      !Number.isInteger(r.imageId) ||
      r.imageId! <= 0 ||
      !Array.isArray(r.printings) ||
      r.printings.length === 0 ||
      !r.printings.every((k) => typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY_LENGTH)
    )
      return bad()
    return { h: r.h, imageId: r.imageId!, printings: r.printings }
  })
  return { v: VERSION, refs }
}
