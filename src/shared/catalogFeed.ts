/** Wire types and limits for the portal's catalog change feed and printing contributions. */

export const MAX_CHANGES = 5000 // page size cap (and default)
export const MAX_CONTRIBUTE = 500 // printings per contribute request
export const CONTRIBUTE_DAILY_CAP = 2000 // per user per rolling 24 h

export type CatalogTableName =
  | 'cards'
  | 'card_images'
  | 'card_printings'
  | 'sets'
  | 'pack_art'
  | 'set_logos'
  | 'konami_logos'
  | 'tcgplayer_groups'
  | 'tcgplayer_products'
  | 'pokemon_cards'

/** The catalog tables the phone downloads; the TCGplayer tables stay off it. */
export const PHONE_TABLES: readonly CatalogTableName[] = [
  'cards',
  'card_images',
  'card_printings',
  'sets',
  'pack_art',
  'set_logos',
  'konami_logos',
  'pokemon_cards'
]

export type CatalogChange =
  | { seq: number; table: CatalogTableName; row: Record<string, string | number | null> }
  | { seq: number; table: CatalogTableName; deleted: (string | number | null)[] }

export interface CatalogChangesResponse {
  changes: CatalogChange[]
  cursor: number
  more: boolean
  dbVersion: string | null
  /** The catalog clock's seq: the newest change on the server, whatever tables were asked for. */
  latest: number
}

export type ContributedPrinting = {
  card_id: number
  set_name: string
  set_code: string
  set_rarity: string
  set_rarity_code: string | null
  language: string
  variant: string | null
  tcg_product_id: number | null
}

export type ContributeResult = {
  pkey: string
  status: 'added' | 'exists' | 'rejected'
  reason?: string
}
