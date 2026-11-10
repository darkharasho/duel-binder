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
/** Japanese One Piece card art on Bandai's Japanese site. */
export const BANDAI_JA_IMAGE_PREFIX = 'https://www.onepiece-cardgame.com/images/cardlist/card/'
/**
 * Where Bandai keeps its product shots (the pack or deck box on each set's product tile), on the
 * English and Japanese sites. A One Piece set's `sets.image_url` is one of these, under an `ob-` key.
 */
export const OP_PACK_PREFIXES = [
  'https://en.onepiece-cardgame.com/renewal/images/products/',
  'https://en.onepiece-cardgame.com/onepiececg/bccard/',
  'https://www.onepiece-cardgame.com/renewal/images/products/',
  'https://www.onepiece-cardgame.com/onepiececg/bccard/'
]
export const isOpPackUrl = (url: string): boolean => OP_PACK_PREFIXES.some((p) => url.startsWith(p))
/** A Bandai card id such as OP01-001 or OP01-001_p1; the only ids the art URL is built from. */
export const BANDAI_ID_RE = /^[A-Z]+[0-9]*-[0-9]{3}(_[a-z][0-9]{1,2})?$/
/**
 * Bandai's PNG for an `onepiece_images.bandai_id`: a bare Bandai id is English art, `ja:<id>`
 * Japanese. Null for any other key (a DON!! card's `tcg:` key, or anything malformed).
 */
export function opBandaiArtUrl(key: string): string | null {
  if (BANDAI_ID_RE.test(key)) return `${BANDAI_EN_IMAGE_PREFIX}${key}.png`
  if (key.startsWith('ja:') && BANDAI_ID_RE.test(key.slice(3)))
    return `${BANDAI_JA_IMAGE_PREFIX}${key.slice(3)}.png`
  return null
}
/**
 * The `onepiece_images.bandai_id` of a One Piece card whose art is TCGplayer's (a DON!! card,
 * which Bandai's English list doesn't have): `tcg:<TCGplayer product id>`.
 */
export const OP_TCG_ART_RE = /^tcg:([1-9][0-9]{0,9})$/
export const opTcgArtKey = (productId: number): string => `tcg:${productId}`
/** TCGplayer's picture of an OP_TCG_ART_RE key at `size`, as Pokémon's TCGplayer art; null for any other key. */
export function opTcgArtUrl(key: string, size: 'small' | 'full'): string | null {
  const m = OP_TCG_ART_RE.exec(key)
  if (!m) return null
  return `${TCGPLAYER_PACK_PREFIX}${m[1]}_${size === 'full' ? 'in_1000x1000' : '200w'}.jpg`
}

/** Scryfall's image host; the only one the portal fetches Magic art from. */
export const SCRYFALL_IMAGE_PREFIX = 'https://cards.scryfall.io/'
const SCRYFALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Scryfall's whole picture of a card object's front (or back) face at `size`; null unless `scryfallId` is a uuid. */
export function scryfallArtUrl(
  scryfallId: string,
  size: 'small' | 'full',
  face: 'front' | 'back' = 'front'
): string | null {
  const id = scryfallId.toLowerCase()
  if (!SCRYFALL_ID_RE.test(id)) return null
  return `${SCRYFALL_IMAGE_PREFIX}${size === 'small' ? 'normal' : 'large'}/${face}/${id[0]}/${id[1]}/${id}.jpg`
}
