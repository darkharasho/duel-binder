export interface CardRow {
  id: number
  name: string
  type: string
  frameType: string
  race: string
  attribute: string | null
  level: number | null
  linkval: number | null
  atk: number | null
  def: number | null
  archetype: string | null
  desc: string
  tcgplayerPrice: number | null
}

export interface Printing {
  id: number
  cardId: number
  setName: string
  setCode: string
  setRarity: string
  setRarityCode: string
  setPrice: number | null
  missingFromApi: boolean
}

/** sortOrder 0 is the original art. */
export interface CardImage {
  imageId: number
  cardId: number
  sortOrder: number
}

export interface CardSearchResult {
  id: number
  name: string
  type: string
  defaultImageId: number
  matchedSetCode: string | null
}

export interface CardDetail {
  card: CardRow
  printings: Printing[]
  images: CardImage[]
}

export interface EntryView {
  id: number
  quantity: number
  notes: string
  createdAt: string
  updatedAt: string
  card: CardRow
  printing: Printing
  imageId: number
  unitPrice: number | null
  priceApproximate: boolean
  totalValue: number
}

export interface AddEntryInput {
  printingId: number
  imageId: number
  quantity: number
}

export interface UpdateEntryInput {
  quantity?: number
  notes?: string
  printingId?: number
  imageId?: number
}

export type SortKey = 'name' | 'value' | 'quantity' | 'added'

export interface CollectionFilters {
  q?: string
  cardTypes?: string[]
  attributes?: string[]
  levelMin?: number
  levelMax?: number
  archetypes?: string[]
  setNames?: string[]
  rarities?: string[]
  sort: SortKey
  dir: 'asc' | 'desc'
}

export interface Facets {
  cardTypes: string[]
  attributes: string[]
  archetypes: string[]
  setNames: string[]
  rarities: string[]
}

export interface CollectionStats {
  totalCards: number
  uniqueCards: number
  totalValue: number
  approximateCount: number
  byRarity: { rarity: string; count: number; value: number }[]
  byFrameType: { frameType: string; count: number }[]
  topEntries: EntryView[]
  pricesUpdatedAt: string | null
}

export interface SyncStatus {
  state: 'idle' | 'checking' | 'downloading' | 'saving' | 'error'
  lastSyncAt: string | null
  dbVersion: string | null
  cardCount: number
  error: string | null
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  mode: 'auto' | 'notify'
  version: string | null
  error: string | null
}
