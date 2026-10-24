import type { Language } from './languages'

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
  language: Language
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
  priceSource: 'ygoprodeck' | 'ebay'
  priceCheckedAt: string | null
  /** eBay listings behind the asking price (non-English copies only). */
  priceListingCount: number | null
  noPriceReason: 'no-listings' | 'pending' | 'unavailable' | null
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
  language?: Language
  sort: SortKey
  dir: 'asc' | 'desc'
}

export interface Facets {
  cardTypes: string[]
  attributes: string[]
  archetypes: string[]
  setNames: string[]
  rarities: string[]
  languages: Language[]
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

/** The eBay price service address shown in Settings. */
export interface PriceSettings {
  /** The saved address, or the built-in one; '' means prices are turned off. */
  url: string
  defaultUrl: string
  isDefault: boolean
  /** YGO_PRICE_WORKER_URL is set, so the saved address is ignored. */
  envOverride: boolean
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  mode: 'auto' | 'notify'
  version: string | null
  error: string | null
}

export type CountMode = 'cards' | 'rarities'

export interface SetSummary {
  language: Language
  setName: string
  setCode: string // sets.set_code, else setPrefix of the set's lowest printing code
  tcgDate: string | null // 'YYYY-MM-DD'
  imageKey: string | null // file stem under images/sets/, already validated
  totalCards: number
  ownedCards: number
  totalRarities: number
  ownedRarities: number
  listRows: number | null // Yugipedia list rows; null for English
  unmatchedRows: number | null // rows not matched to a card; null for English
}

export interface ChecklistCode {
  printingId: number
  setCode: string
  owned: number
}

export interface ChecklistRarity {
  rarity: string
  owned: number
  codes: ChecklistCode[] // sorted by setCode
  defaultPrintingId: number // pickDefaultCode over codes
  entryId: number | null // most recently updated entry of this rarity in this set
}

export interface ChecklistCard {
  cardId: number
  name: string
  type: string
  number: number | null
  numberLabel: string // from the lowest-numbered code
  imageId: number // original art (card_images sort_order 0)
  owned: number // sum over rarities
  entryId: number | null // most recently updated entry of the card in this set
  rarities: ChecklistRarity[] // sorted by rarity name
}

export interface SetChecklist {
  set: SetSummary
  cards: ChecklistCard[]
}
