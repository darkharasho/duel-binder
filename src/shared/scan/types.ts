import type { Language } from '../languages'
/** Raw pixels, 4 bytes per pixel (R, G, B, A), row-major. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

/** A printing, in any language, that the scanner can match a card to. */
export interface ScanPrinting {
  printingId: number
  cardId: number
  name: string
  frameType: string
  setName: string
  setCode: string
  rarity: string
  /** card_printings.variant, e.g. "Overframe" or "Manga-Style"; absent or null when plain. */
  variant?: string | null
  language: Language
  /** USD, this printing's own price; null when unknown. */
  price: number | null
  /** The card's artworks, in sort order. */
  imageIds: number[]
  /**
   * A Pokémon card's name as printed, when the catalog's name is another (a Japanese card is
   * named in English); left out otherwise, and on every Yu-Gi-Oh printing.
   */
  localName?: string
  /** A Pokémon card's rarity as printed; `rarity` is its version. Left out when it has none. */
  printedRarity?: string
  /**
   * A Pokémon card with a likely reprint of its art the scanner can't see: a card of the same
   * name and illustrator, in the same language, with no artwork in the catalog (the Classic
   * Collections) or only a tcgplayer product photo (trainer kits). Its art alone can't tell the
   * two apart. Set by printingsForCards only; left out otherwise.
   */
  unseenTwin?: true
  /** Those cards' set codes: a number read can still tell the two apart. Set with unseenTwin. */
  unseenTwinCodes?: string[]
  /** Those cards' artworks: a product photo unlike this card's art is no reprint of it. */
  unseenTwinImages?: number[]
}

export type FingerprintStatus = {
  state: 'ready' | 'missing' | 'downloading' | 'error'
  count: number
  /** How much of a download has arrived, 0 to 1, when its size is known. */
  progress?: number
  /** Set by a refresh that wrote a new file to disk. */
  updated?: true
}

/** A grayscale crop for OCR, 1 byte per pixel. */
export interface OcrBand {
  width: number
  height: number
  data: Uint8Array
}

/** A card the scanner recognized, ready to go in the session list. */
export interface ScanDraft {
  cardId: number
  name: string
  imageId: number
  /** Null only on rows saved before every scan came with a printing. */
  printingId: number | null
  setCode: string | null
  rarity: string | null
  /** The printings the user may switch to. */
  options: ScanPrinting[]
  flag: 'check-rarity' | 'pick-printing' | 'other-set' | null
  via: 'code' | 'art' | 'name'
  /** A Pokémon card; left out for Yu-Gi-Oh, so its drafts are as they always were. */
  game?: 'pkm'
  /** Shown in a graded slab; priced as the raw card. */
  slab?: true
  /**
   * The scanner's best guess at a Pokémon card, not a certain match: shown as such until the user
   * has looked at it. Left out when certain, as it always is for Yu-Gi-Oh.
   */
  guess?: true
  /**
   * The printings a reference scan of their art told the photo for (an overframe family, say),
   * which the rarity's look then picks among; absent when no scan did.
   */
  artPrintings?: number[]
}
