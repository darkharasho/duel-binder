import { isSameNumber, OWN_NUMBERS, plainName, sameCardName } from './match'
import type { PkmLang, TcProduct, TdCard, TdSet } from './types'

/**
 * Art for the cards TCGdex has no image for and product matching left without one, from TCGplayer
 * product images (TCGCSV). Art only: a card's printings, prices and names don't move. A wrong image
 * is worse than none, so a product counts only when its set, number and name all agree with the
 * card, and a card with no such product stays without art.
 */

/**
 * The TCGCSV groups of the sets matchGroup can't place: Japanese groups from before about 2008 have
 * no abbreviation and English names, TCGdex's "+" sets are "p" in their ids, and some of TCGdex's
 * English sets are split off a group (or a group off a set). Ids, not names, so a rename upstream
 * changes nothing. Tried in order, then the set's matched group.
 */
export const ART_GROUPS: Record<PkmLang, Readonly<Record<string, readonly number[]>>> = {
  'zh-hans': {},
  'zh-hant': {},
  en: {
    '2021swsh': [2782], // McDonald's 25th Anniversary Promos
    '30th-c': [24837], // ME: 30th Celebration Classic Collection
    bwp: [1407], // Black and White Promos
    cel25cc: [2931, 2867], // Celebrations: Classic Collection, then Celebrations (two sit there)
    ecard2: [1397], // Aquapolis
    exu: [1398], // EX Unseen Forces
    swsh9tg: [3020], // SWSH09: Brilliant Stars Trainer Gallery
    'tk-hs-g': [1540], // HGSS Trainer Kit: Gyarados & Raichu
    'tk-sm-r': [2069], // SM Trainer Kit: Lycanroc & Alolan Raichu
    'tk-xy-n': [1532], // XY Trainer Kit: Sylveon & Noivern
    'tk-xy-sy': [1532],
    xy8: [1938], // Alternate Art Promos
    xya: [1938],
    xyp: [1451] // XY Promos
  },
  ja: {
    E1: [23730], // Base Expansion Pack
    E2: [23731], // The Town on No Map
    E3: [23732], // Wind from the Sea
    E4: [23733], // Split Earth
    E5: [23734], // Mysterious Mountains
    M2a: [24499], // M2a: High Class Pack: MEGA Dream ex
    'M-P': [24423], // M-P Promotional Cards
    MC: [24567], // Start Deck 100 Battle Collection
    PCG1: [24117], // Flight of Legends
    PCG2: [24114], // Clash of the Blue Sky
    PCG3: [24135], // Rocket Gang Strikes Back
    PCG4: [24103], // Golden Sky, Silvery Ocean
    PCG5: [24101], // Mirage Forest
    PCG6: [24085], // Holon Research Tower
    PCG7: [24084], // Holon Phantom
    PCG8: [24099], // Miracle Crystal
    PCG9: [24090], // Offense and Defense of the Furthest Ends
    SM1p: [23880], // sm1+: Enhanced Expansion Pack Sun & Moon
    SM2p: [23693], // SM2+: Facing a New Trial
    SM3p: [23694], // SM3+: Shining Legends
    SM4p: [23707], // SM4+: GX Battle Boost
    SM5p: [23695], // SM5+: Ultra Force
    SM8b: [23708], // SM8b: GX Ultra Shiny
    SM10: [23689], // SM10: Double Blaze
    SM12a: [23709], // SM12a: TAG TEAM GX: Tag All Stars
    'SV-P': [23779], // SV-P Promotional Cards
    VS1: [24180], // Pokemon VS
    web1: [24141] // Pokemon Web
  }
}

/** Product notes that only name a finish: the art is the same under either. */
const FINISH_NOTE = /^(?:non-holo|holo|holofoil|reverse holo|reverse holofoil|mirror holo|mirror holofoil|cosmos holo)$/i

/** The notes in a product's name, "(...)" and "[...]"; a few upstream names leave one unclosed. */
export const notes = (name: string): string[] =>
  [...name.matchAll(/[([]([^()[\]]*)/g)].map((m) => m[1].trim())

const isStaff = (p: TcProduct): boolean => notes(p.name).some((n) => /^staff$/i.test(n))

/** A Japanese group can hold decks numbered on their own, "001/023" beside the set's "001/742". */
function ownCount(lang: PkmLang, set: TdSet, number: string): boolean {
  if (lang !== 'ja') return true
  const count = /\/\s*(\d+)$/.exec(number)
  if (!count) return true
  const n = parseInt(count[1], 10)
  return n === set.cardCount?.official || n === set.cardCount?.total
}

/** The one art among products of one number and name, or null when they don't settle on one. */
function pickArt(hits: TcProduct[]): TcProduct | null {
  // A [Staff] stamp is the same card with a stamp no one else's copy has.
  const crew = hits.filter((p) => !isStaff(p))
  const pool = crew.length > 0 ? crew : hits
  if (pool.length <= 1) return pool[0] ?? null
  const plain = pool.filter((p) => notes(p.name).length === 0)
  if (plain.length === 1) return plain[0]
  if (plain.length > 1) return null
  if (!pool.every((p) => notes(p.name).every((n) => FINISH_NOTE.test(n)))) return null
  return pool.reduce((a, b) => (b.productId < a.productId ? b : a))
}

const cardProductIds = (card: TdCard): number[] => {
  const ids = (card.variants_detailed ?? []).map((v) => v.thirdParty?.tcgplayer)
  return [...ids, card.thirdParty?.tcgplayer].filter((id): id is number => typeof id === 'number')
}

export type ArtOutcome = 'filled' | 'no group' | 'no number' | 'no name' | 'japanese name' | 'unsettled'

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

/**
 * The image for a card with none, and why not when there is none. `names` are the card's names (its
 * English name when it has one, its species); `groupId` is its set's matched group.
 */
export function findArt(
  lang: PkmLang,
  set: TdSet,
  groupId: number | null,
  card: TdCard,
  names: string[],
  inGroup: Map<number, TcProduct[]>
): { imageUrl: string | null; outcome: ArtOutcome } {
  const groups = [...new Set([...(ART_GROUPS[lang][set.id] ?? []), ...(groupId === null ? [] : [groupId])])]
  if (groups.length === 0) return { imageUrl: null, outcome: 'no group' }
  let outcome: ArtOutcome = 'no number'
  for (const g of groups) {
    const products = (inGroup.get(g) ?? []).filter((p) => p.imageUrl)
    const byNumber = OWN_NUMBERS.has(set.id)
      ? products.filter((p) => cardProductIds(card).includes(p.productId))
      : products.filter(
          (p) => p.number !== null && isSameNumber(card.localId, p.number) && ownCount(lang, set, p.number)
        )
    if (byNumber.length === 0) continue
    const english = names.filter((n) => !JAPANESE.test(n))
    if (english.length === 0) {
      outcome = 'japanese name'
      continue
    }
    const named = byNumber.filter((p) => english.some((n) => sameCardName(n, p.name)))
    if (named.length === 0) {
      outcome = 'no name'
      continue
    }
    const art = pickArt(named)
    if (art) return { imageUrl: art.imageUrl!, outcome: 'filled' }
    outcome = 'unsettled'
  }
  return { imageUrl: null, outcome }
}

/**
 * The TCGCSV groups of the sets whose products have no numbers, where only a name can place a card:
 * Japanese groups from the neo era and before.
 */
export const NAME_GROUPS: Readonly<Record<string, number>> = {
  neo1: 23727, // Gold, Silver, to a New World...
  neo2: 23728, // Crossing the Ruins...
  neo3: 23720, // Awakening Legends
  neo4: 23729, // Darkness, and to Light...
  PMCG2: 23722, // Pokemon Jungle
  PMCG5: 23725, // Leaders' Stadium
  PMCG6: 23726 // Challenge from the Darkness
}

/**
 * Art by name, for a NAME_GROUPS set: `cards` is every card of the set, each with its names. A card
 * takes a product only when the name leaves that one product, and no other card of the set lands on
 * it: two Pikachu, or a Dark and a Light Dragonite on one species, stay without art. The same name
 * beats the same base name, so a plain Gyarados isn't lost to a Shining one beside it. Returns the
 * image by card id.
 */
export function findArtByName(
  groupId: number,
  cards: { id: string; names: string[] }[],
  inGroup: Map<number, TcProduct[]>
): Map<string, string> {
  const products = (inGroup.get(groupId) ?? []).filter((p) => p.imageUrl)
  const claims = new Map<number, { id: string; product: TcProduct }[]>()
  for (const { id, names } of cards) {
    const english = names.filter((n) => !JAPANESE.test(n))
    const same = products.filter((p) => english.some((n) => plainName(n) === plainName(p.name)))
    const hits = same.length > 0 ? same : products.filter((p) => english.some((n) => sameCardName(n, p.name)))
    const product = pickArt(hits)
    if (!product) continue
    claims.set(product.productId, [...(claims.get(product.productId) ?? []), { id, product }])
  }
  const out = new Map<string, string>()
  for (const claim of claims.values()) {
    if (claim.length === 1) out.set(claim[0].id, claim[0].product.imageUrl!)
  }
  return out
}
