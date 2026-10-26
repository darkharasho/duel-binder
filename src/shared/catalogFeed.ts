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

export type CatalogChange =
  | { seq: number; table: CatalogTableName; row: Record<string, string | number | null> }
  | { seq: number; table: CatalogTableName; deleted: (string | number | null)[] }

export interface CatalogChangesResponse {
  changes: CatalogChange[]
  cursor: number
  more: boolean
  dbVersion: string | null
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
