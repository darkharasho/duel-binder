/** The languages TCGdex and TCGCSV both serve. */
export type TdLang = 'en' | 'ja'
/** The languages TCGdex serves and TCGCSV doesn't, read in the English vocabulary (european.ts). */
export type EuropeanLang = 'fr' | 'de' | 'it' | 'es'
export type PkmLang = TdLang | EuropeanLang | 'zh-hans' | 'zh-hant'
/** The catalog's languages whose cards come from TCGdex's card pages, so sit in the card cache. */
export type CachedLang = TdLang | EuropeanLang | 'zh-hant'
/**
 * One TCGdex printing of a card. `variantId` is "generated" when TCGdex had no curated variant list
 * for the card and filled this one in from its legacy `variants` booleans (see GENERATED in versions.ts).
 */
export interface TdVariant { type: string; subtype?: string; stamp?: string[]; foil?: string; thirdParty?: { tcgplayer?: number }; variantId?: string }
export interface TdCard {
  id: string; localId: string; name: string; localName?: string; category?: string; rarity?: string | null; hp?: number
  types?: string[]; stage?: string; illustrator?: string; image?: string
  abilities?: { type?: string; name: string; effect?: string }[]
  attacks?: { cost?: string[]; name: string; damage?: string | number; effect?: string }[]
  variants_detailed?: TdVariant[]; thirdParty?: { tcgplayer?: number }
  /** National Pokédex numbers of a Pokémon card (one per Pokémon on it). */
  dexId?: number[]
  /** TCGdex's mechanic for the card, in its own spelling ("EX" on a Scarlet & Violet ex). */
  suffix?: string
  /** The number as printed, when it isn't "{localId}/{official}" ("R/RGB"). */
  printed?: string
  /** The list's English card of the same rules, and the card's mark there; see artTwins.ts. */
  englishTwin?: { setCode: string; number: string; mark: string }
  /** Built from TCGplayer's rows (upcoming.ts), so its name is already English and plain. */
  fromTcgplayer?: boolean
  set: { id: string; name: string }
}
export interface TdSet {
  id: string; name: string; releaseDate?: string; logo?: string; serie?: { id: string }
  abbreviation?: { official?: string }; cardCount?: { official?: number; total?: number }
  cards: { id: string; localId: string; name: string }[]
}
export interface TcGroup { groupId: number; name: string; abbreviation: string | null; publishedOn?: string }
export interface TcProduct {
  productId: number; groupId: number; name: string; imageUrl?: string; number: string | null
  details?: Record<string, string>
}
/** A product with TCGplayer's card details (Number, Rarity, HP, ...) by field name. */
export interface TcCardRow { productId: number; name: string; details: Record<string, string> }
export interface TcPrice { productId: number; subTypeName: string; marketPrice: number | null }
export interface PokemonSources {
  sets(lang: PkmLang): Promise<TdSet[]> // full sets, cards brief
  cards(lang: PkmLang, ids: string[]): Promise<TdCard[]> // cached per the refetch rule
  groups(lang: PkmLang): Promise<TcGroup[]> // en → cat 3, ja → cat 85
  products(lang: PkmLang, groupId: number): Promise<TcProduct[]>
  prices(lang: PkmLang, groupId: number): Promise<TcPrice[]>
}
