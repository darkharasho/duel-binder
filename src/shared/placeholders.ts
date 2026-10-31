/** Printable stand-ins for a binder's empty pockets: nine true-size cards to a Letter sheet. */
export interface PlaceholderCard {
  imageId: number
  name: string
  /** The printed number ("DLR 011/103"). */
  number: string
  rarity: string | null
}

export const PLACEHOLDER_STYLES = {
  soft: { label: 'Soft colour', saturation: 0.3 },
  color: { label: 'Full colour', saturation: 1 },
  gray: { label: 'Grayscale', saturation: 0 }
} as const

export type PlaceholderStyle = keyof typeof PLACEHOLDER_STYLES

export interface PlaceholderRequest {
  setName: string
  /** Names the footer chip on cards with no rarity chip. */
  setCode: string
  style: PlaceholderStyle
  cards: PlaceholderCard[]
}

export const CARDS_PER_SHEET = 9

export const sheetCount = (cards: number): number => Math.ceil(cards / CARDS_PER_SHEET)

/** More pockets than any set has; bounds what crosses to the main process. */
export const MAX_PLACEHOLDERS = 1000

/** The cards worth spotting across a sheet get a coloured chip; an illustration rare has one finish. */
export function rarityChip(rarity: string | null): { text: string; color: string } | null {
  const r = rarity?.trim().toLowerCase()
  if (r === 'illustration rare') return { text: 'IR', color: '#8ecdf0' }
  if (r === 'special illustration rare') return { text: 'SIR', color: '#cea0f0' }
  return null
}

/** Checks what crossed from the renderer: these strings end up in a page and a file name. */
export function checkPlaceholderRequest(input: unknown): PlaceholderRequest {
  const r = input as PlaceholderRequest
  const ok =
    typeof r?.setName === 'string' &&
    typeof r.setCode === 'string' &&
    Object.hasOwn(PLACEHOLDER_STYLES, r.style) &&
    Array.isArray(r.cards) &&
    r.cards.length > 0 &&
    r.cards.length <= MAX_PLACEHOLDERS &&
    r.cards.every(
      (c) =>
        Number.isSafeInteger(c?.imageId) &&
        c.imageId > 0 &&
        typeof c.name === 'string' &&
        typeof c.number === 'string' &&
        (c.rarity === null || typeof c.rarity === 'string')
    )
  if (!ok) throw new Error('Bad placeholder request')
  return r
}
