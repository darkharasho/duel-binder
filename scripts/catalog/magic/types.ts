/** The subset of Scryfall's card object the Magic job reads, with Scryfall's own field names. */
export interface ScryFace {
  name: string
  oracle_id?: string
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  colors?: string[]
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  illustration_id?: string
  artist?: string
  image_uris?: Record<string, string>
}

export interface ScryCard {
  id: string
  oracle_id?: string
  name: string
  lang: string
  layout: string
  set: string
  set_name: string
  collector_number: string
  rarity: string
  released_at: string
  games: string[]
  digital: boolean
  finishes: string[]
  prices: { usd: string | null; usd_foil: string | null; usd_etched: string | null }
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  colors?: string[]
  color_identity: string[]
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  keywords: string[]
  card_faces?: ScryFace[]
  illustration_id?: string
  artist?: string
  frame: string
  border_color: string
  full_art: boolean
  promo_types?: string[]
  image_uris?: Record<string, string>
}

export interface ScrySet {
  code: string
  name: string
  released_at?: string
  parent_set_code?: string
  set_type: string
}

export interface ScryfallSource {
  bulkInfo(): Promise<{ downloadUri: string; updatedAt: string }>
  /** Every object in the bulk file, unfiltered. */
  cards(downloadUri: string): AsyncIterable<ScryCard>
  sets(): Promise<ScrySet[]>
}
