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
  language: Language
  /** USD, this printing's own price; null when unknown. */
  price: number | null
  /** The card's artworks, in sort order. */
  imageIds: number[]
}

export type FingerprintStatus = {
  state: 'ready' | 'missing' | 'downloading' | 'error'
  count: number
  /** Set by a refresh that wrote a new file to disk. */
  updated?: true
}

/** A grayscale crop for OCR, 1 byte per pixel. */
export interface OcrBand {
  width: number
  height: number
  data: Uint8Array
}
