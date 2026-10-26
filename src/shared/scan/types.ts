/** Raw pixels, 4 bytes per pixel (R, G, B, A), row-major. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

/** An English printing the scanner can match a card to. */
export interface ScanPrinting {
  printingId: number
  cardId: number
  name: string
  frameType: string
  setName: string
  setCode: string
  rarity: string
  /** The card's artworks, in sort order. */
  imageIds: number[]
}

export type FingerprintStatus = {
  state: 'ready' | 'missing' | 'downloading' | 'error'
  count: number
}

/** A grayscale crop for OCR, 1 byte per pixel. */
export interface OcrBand {
  width: number
  height: number
  data: Uint8Array
}
