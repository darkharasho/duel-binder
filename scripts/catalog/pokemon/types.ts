export type PkmLang = 'en' | 'ja'
export interface TdVariant { type: string; subtype?: string; stamp?: string[]; thirdParty?: { tcgplayer?: number } }
export interface TdCard {
  id: string; localId: string; name: string; category?: string; rarity?: string | null; hp?: number
  types?: string[]; stage?: string; illustrator?: string; image?: string
  abilities?: { type?: string; name: string; effect?: string }[]
  attacks?: { cost?: string[]; name: string; damage?: string | number; effect?: string }[]
  variants_detailed?: TdVariant[]; thirdParty?: { tcgplayer?: number }
  set: { id: string; name: string }
}
export interface TdSet {
  id: string; name: string; releaseDate?: string; logo?: string
  abbreviation?: { official?: string }; cardCount?: { official?: number }
  cards: { id: string; localId: string; name: string }[]
}
export interface TcGroup { groupId: number; name: string; abbreviation: string | null }
export interface TcProduct { productId: number; groupId: number; name: string; imageUrl?: string; number: string | null }
export interface TcPrice { productId: number; subTypeName: string; marketPrice: number | null }
export interface PokemonSources {
  sets(lang: PkmLang): Promise<TdSet[]> // full sets, cards brief
  cards(lang: PkmLang, ids: string[]): Promise<TdCard[]> // cached per the refetch rule
  groups(lang: PkmLang): Promise<TcGroup[]> // en → cat 3, ja → cat 85
  products(lang: PkmLang, groupId: number): Promise<TcProduct[]>
  prices(lang: PkmLang, groupId: number): Promise<TcPrice[]>
}
