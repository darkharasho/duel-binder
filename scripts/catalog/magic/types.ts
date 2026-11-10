/** The subset of Scryfall's card object the Magic job reads, with Scryfall's own field names. */
export interface ScryFace {
  name: string
  printed_name?: string
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
  printed_name?: string
  image_status?: string
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
  /** The set's symbol, e.g. https://svgs.scryfall.io/sets/dsk.svg?1794200400 (the query is its version). */
  icon_svg_uri?: string
}

export interface ScryfallSource {
  bulkInfo(): Promise<{ downloadUri: string; updatedAt: string }>
  /** Every object in the bulk file, unfiltered, slimmed (see `slimCard`). */
  cards(downloadUri: string): AsyncIterable<ScryCard>
  sets(): Promise<ScrySet[]>
  /** A set symbol's SVG text, from svgs.scryfall.io (see symbols.ts). */
  symbolSvg(url: string): Promise<string>
}
