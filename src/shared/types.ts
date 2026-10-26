import type { Me } from './cloud'
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
  /** This printing's price: its TCGplayer market price, else YGOPRODeck's set price. */
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
  /** The entry uses the card's original artwork, so the printing's own photo can stand in for it. */
  originalArt: boolean
  unitPrice: number | null
  priceApproximate: boolean
  priceSource: 'tcgplayer' | 'ygoprodeck' | 'ebay'
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

export type BrowseSort = 'name' | 'released' | 'price' | 'atk' | 'def' | 'level'

/** Filters for the Browse page: every card in the database, not just owned ones. */
export interface BrowseFilters {
  q?: string
  cardTypes?: string[]
  attributes?: string[]
  races?: string[]
  archetypes?: string[]
  setNames?: string[]
  rarities?: string[]
  levelMin?: number
  levelMax?: number
  owned?: 'all' | 'owned' | 'missing'
  sort: BrowseSort
  dir: 'asc' | 'desc'
  offset?: number
  limit?: number
}

export interface BrowseCard {
  id: number
  name: string
  type: string
  frameType: string
  attribute: string | null
  race: string
  level: number | null
  linkval: number | null
  atk: number | null
  def: number | null
  imageId: number
  /** TCGplayer market price for the card (cheapest English printing), when known. */
  price: number | null
  /** Earliest English release date across its printings ('YYYY-MM-DD'). */
  releasedAt: string | null
  /** Copies owned in any printing or language. */
  owned: number
  /** An English printing to preselect when adding the card, if it has one. */
  defaultPrintingId: number | null
}

export interface BrowsePage {
  cards: BrowseCard[]
  total: number
}

export interface BrowseFacets {
  cardTypes: string[]
  attributes: string[]
  races: string[]
  archetypes: string[]
  setNames: string[]
  rarities: string[]
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
  /** Newest additions first. */
  recentEntries: EntryView[]
  /** One point per day the value was recorded, oldest first. */
  valueHistory: ValuePoint[]
  pricesUpdatedAt: string | null
}

export interface ValuePoint {
  /** Local date, YYYY-MM-DD. */
  date: string
  totalValue: number
  totalCards: number
}

export interface SyncStatus {
  state: 'idle' | 'checking' | 'downloading' | 'saving' | 'error'
  lastSyncAt: string | null
  dbVersion: string | null
  cardCount: number
  error: string | null
  /** Why the switch to the server's catalog hasn't finished yet; null once it has (or before it's tried). */
  blocked: string | null
}

/** The desktop's Duel Binder account, as the renderer sees it. Never carries the token. */
export interface AccountStatus {
  state: 'signed-out' | 'signing-in' | 'idle' | 'syncing' | 'offline' | 'error'
  /** The signed-in account. */
  user: Me | null
  /** Name of the account whose cards this computer shows (kept after sign-out). */
  localOwner: string | null
  lastSyncedAt: string | null
  error: string | null
  /** The shown account's entries waiting for this computer's catalog to gain their printing. */
  pendingCount: number
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
  packImageKey: string | null // official pack render, under images/sets/ like imageKey
  logoImageKey: string | null // English set logo from Yugipedia, under images/sets/ like imageKey
  coverImageId: number | null // artwork of the set's headline card (its rarest printing)
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
  price: number | null // dearest printing price of this rarity in this set
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
  price: number | null // dearest printing price in this set, else the card's price
  atk: number | null
  def: number | null
  level: number | null // level, rank or link rating
}

export interface SetChecklist {
  set: SetSummary
  cards: ChecklistCard[]
}

export interface FriendUser {
  id: number
  username: string
  displayName: string | null
  avatarUrl: string | null
}

export interface Friend extends FriendUser {
  /** Copies across live entries (sum of quantity). */
  cardCount: number
  /** Latest change to any of their entries, tombstones included; null with none. */
  updatedAt: string | null
}

export interface FriendRequest extends FriendUser {
  sentAt: string
}

export interface FriendsOverview {
  friends: Friend[]
  incoming: FriendRequest[]
  /** People you've blocked, by name. */
  blocked: FriendUser[]
}

export type FriendRequestResult = { status: 'sent' } | { status: 'accepted'; friend: FriendUser }
