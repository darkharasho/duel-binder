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

/**
 * Yugipedia's file URLs as stored and checked. Its files now live on img.yugipedia.com, and ms
 * answers with a 301 there; stored URLs (and the cache keys hashed from them) keep ms, and are
 * fetched from img (yugipediaFetchUrl).
 */
export const YUGIPEDIA_IMAGE_PREFIX = 'https://ms.yugipedia.com/'
/** Where Yugipedia serves its files now. */
export const YUGIPEDIA_FILE_PREFIX = 'https://img.yugipedia.com/'

/** The URL to fetch a stored Yugipedia file URL from: its img host. Any other URL as it is. */
export const yugipediaFetchUrl = (url: string): string =>
  url.startsWith(YUGIPEDIA_IMAGE_PREFIX)
    ? YUGIPEDIA_FILE_PREFIX + url.slice(YUGIPEDIA_IMAGE_PREFIX.length)
    : url
/** Official pack renders from the English Yu-Gi-Oh! TCG site. */
export const PACK_ART_PREFIX = 'https://www.yugioh-card.com/en/wp-content/uploads/'
export const KONAMI_LOGO_PREFIX = 'https://img.konami.com/'
/** Pokémon booster pack images on TCGplayer, for sets the Bulbagarden Archives doesn't have yet. */
export const TCGPLAYER_PACK_PREFIX = 'https://tcgplayer-cdn.tcgplayer.com/product/'

/** Pokémon booster pack images on the Bulbagarden Archives, mirrored into the portal's R2. */
export const BULBAGARDEN_IMAGE_PREFIX = 'https://archives.bulbagarden.net/media/upload/'
/** Pokémon set logos from the Pokémon TCG API, for sets TCGdex has none for. */
export const POKEMONTCG_IMAGE_PREFIX = 'https://images.pokemontcg.io/'
/** Where the same API keeps the logos of its newest sets. */
export const SCRYDEX_IMAGE_PREFIX = 'https://images.scrydex.com/pokemon/'

/**
 * Art the owner supplied, kept only in the portal's R2 (under hand/, put there by hand; the images
 * are not in this repo). A card's URL is the base of its low.jpg and high.jpg, as TCGdex's is.
 */
export const HAND_ART_PREFIX = 'https://app.duelbinder.com/img/hand/'

export const isFallbackLogoUrl = (url: string): boolean =>
  url.startsWith(POKEMONTCG_IMAGE_PREFIX) ||
  url.startsWith(SCRYDEX_IMAGE_PREFIX) ||
  url.startsWith(HAND_ART_PREFIX)

/** English One Piece card art on Bandai's site: `<bandai id>.png`. */
export const BANDAI_EN_IMAGE_PREFIX = 'https://en.onepiece-cardgame.com/images/cardlist/card/'
/** A Bandai card id such as OP01-001 or OP01-001_p1; the only ids the art URL is built from. */
export const BANDAI_ID_RE = /^[A-Z]+[0-9]*-[0-9]{3}(_[a-z][0-9]{1,2})?$/
