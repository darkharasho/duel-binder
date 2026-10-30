/** 'cropped' is the artwork alone, without the card frame. */
export type ImageSize = 'small' | 'full' | 'cropped'

const IMAGE_FOLDER: Record<ImageSize, string> = {
  small: 'cards_small',
  full: 'cards',
  cropped: 'cards_cropped'
}

export function imageUrl(size: ImageSize, id: number): string {
  return `https://images.ygoprodeck.com/images/${IMAGE_FOLDER[size]}/${id}.jpg`
}

export function setImageUrl(key: string): string {
  return `https://images.ygoprodeck.com/images/sets/${key}.jpg`
}

export const SET_KEY_RE = /^[A-Za-z0-9_-]+$/

export const YUGIPEDIA_IMAGE_PREFIX = 'https://ms.yugipedia.com/'
/** Official pack renders from the English Yu-Gi-Oh! TCG site. */
export const PACK_ART_PREFIX = 'https://www.yugioh-card.com/en/wp-content/uploads/'
export const KONAMI_LOGO_PREFIX = 'https://img.konami.com/'
/** Pokémon booster pack images on the Bulbagarden Archives, mirrored into the portal's R2. */
export const BULBAGARDEN_IMAGE_PREFIX = 'https://archives.bulbagarden.net/media/upload/'
/** Pokémon set logos from the Pokémon TCG API, for sets TCGdex has none for. */
export const POKEMONTCG_IMAGE_PREFIX = 'https://images.pokemontcg.io/'
/** Where the same API keeps the logos of its newest sets. */
export const SCRYDEX_IMAGE_PREFIX = 'https://images.scrydex.com/pokemon/'

export const isFallbackLogoUrl = (url: string): boolean =>
  url.startsWith(POKEMONTCG_IMAGE_PREFIX) || url.startsWith(SCRYDEX_IMAGE_PREFIX)
