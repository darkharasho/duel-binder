import type { BinderEditAction, BinderEditLevel, BinderGoal, BinderRules } from './binders'
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
  /** A Pokémon card's own facts (from pokemon_cards); absent on Yu-Gi-Oh!. */
  pokemon?: PokemonFacts
}

export interface PokemonFacts {
  category: string
  hp: number | null
  types: string[]
  stage: string | null
  rarity: string | null
  illustrator: string | null
  /** The card's Japanese name, when it has one. */
  localName: string | null
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
  /** The printing's sync key, which binders refer to it by. Only where the query selects it. */
  pkey?: string
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
  /** The printing's set's release date, as YYYY-MM-DD; the English set's if its own has none. */
  releaseDate?: string | null
  card: CardRow
  printing: Printing
  /**
   * The artwork shown when the printing has no scan of its own. Users no longer pick it: it is the
   * card's original art, the art the scanner matched, or one picked in an older version; kept
   * (and synced) as before.
   */
  imageId: number
  /**
   * The printing's own scan shows over imageId. False only for a friend's entry seen from the
   * desktop or phone app, whose printing ids are the server's, not this catalog's.
   */
  printingScan: boolean
  unitPrice: number | null
  priceApproximate: boolean
  /** null: no price from any source the entry's game has (Pokémon has only TCGplayer for now). */
  priceSource: 'tcgplayer' | 'ygoprodeck' | 'ebay' | null
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
  /**
   * Names this add, so sending it again (its reply was lost, the page reloaded mid-add) returns
   * the first result instead of adding the copies twice.
   */
  requestId?: string
}

export interface UpdateEntryInput {
  quantity?: number
  notes?: string
  printingId?: number
  /** No longer sent by the app (art comes from the printing); still accepted from older clients. */
  imageId?: number
}

/** 'value' is an entry's total (price × quantity); 'unitPrice' is one copy's price. */
export type SortKey = 'name' | 'value' | 'unitPrice' | 'quantity' | 'added' | 'released'

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
  /** Pokémon only (ignored on Yu-Gi-Oh!, as the Yu-Gi-Oh! fields are ignored on Pokémon). */
  pkmCategories?: string[]
  pkmTypes?: string[]
  pkmStages?: string[]
  pkmRarities?: string[]
  hpMin?: number
  hpMax?: number
  sort: SortKey
  dir: 'asc' | 'desc'
}

/** 'atk', 'def' and 'level' are Yu-Gi-Oh! only and 'hp' is Pokémon only; on the other game each sorts by name. */
export type BrowseSort = 'name' | 'released' | 'price' | 'atk' | 'def' | 'level' | 'hp'

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
  /** Pokémon only (ignored on Yu-Gi-Oh!, as the Yu-Gi-Oh! fields are ignored on Pokémon). */
  pkmCategories?: string[]
  pkmTypes?: string[]
  pkmStages?: string[]
  pkmRarities?: string[]
  hpMin?: number
  hpMax?: number
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
  /** Pokémon only: filled on Pokémon, absent otherwise (the Yu-Gi-Oh! facets are empty arrays there). */
  pkmCategories?: string[]
  pkmTypes?: string[]
  pkmStages?: string[]
  pkmRarities?: string[]
}

export interface Facets {
  cardTypes: string[]
  attributes: string[]
  archetypes: string[]
  setNames: string[]
  rarities: string[]
  languages: Language[]
  /** Pokémon only: filled on Pokémon, absent otherwise (the Yu-Gi-Oh! facets are empty arrays there). */
  pkmCategories?: string[]
  pkmTypes?: string[]
  pkmStages?: string[]
  pkmRarities?: string[]
}

export interface CollectionStats {
  totalCards: number
  uniqueCards: number
  totalValue: number
  approximateCount: number
  /**
   * Copies with no price at all (left out of totalValue, never counted as $0). Optional: a server that
   * predates it doesn't send it.
   */
  unpricedCount?: number
  /** `unpriced`: copies of the rarity with no price (optional, as unpricedCount). */
  byRarity: { rarity: string; count: number; value: number; unpriced?: number }[]
  /** Yu-Gi-Oh!'s frame types; on Pokémon the category (Pokémon/Trainer/Energy) in the same field. */
  byFrameType: { frameType: string; count: number }[]
  topEntries: EntryView[]
  /** The dearest single copies: entries by unit price. */
  topSingles: EntryView[]
  /** Newest additions first. */
  recentEntries: EntryView[]
  /** One point per day the value was recorded, oldest first. */
  valueHistory: ValuePoint[]
  pricesUpdatedAt: string | null
}

/** A friend's dashboard. `valueHistory` is always empty: their history stays theirs. */
export interface FriendStats extends CollectionStats {
  /** Distinct cards both of you have, in any printing. */
  sharedCards: number
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
  /** When a blocked switch tries again: on the next run (Retry can help), or only after a restart. */
  blockedRetry: 'next-run' | 'next-launch' | null
}

/**
 * The desktop's image downloads since its queue was last empty (all zeros when none are under
 * way). Images download as pages ask for them, so a first visit to a page queues its art.
 */
export interface ImageDownloads {
  /** Card art and printing scans. */
  cards: { done: number; total: number }
  /** Set logos, pack art and set images. */
  sets: { done: number; total: number }
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
  /** The shown account's entries that can't sync (see `UnsyncedEntry`). */
  unsyncedCount: number
  /** The app can't be used signed out; false only in the dev fake-data profile. */
  signInRequired: boolean
}

/** A collection entry the server can't take, with why. */
export interface UnsyncedEntry {
  uid: string
  name: string
  setCode: string
  setName: string
  rarity: string
  language: Language
  quantity: number
  reason: string
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
  coverImageId: number | null // artwork of the set's hit, or its rarest printing with no prices
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
  cardRarity?: string | null // Pokémon only: the card's own rarity (null when unknown), apart from its finishes
  hp?: number | null // Pokémon only
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

/** A friend's copies of one printing of a card. */
export interface FriendCardPrinting {
  setCode: string
  rarity: string
  language: Language
  quantity: number
}

/** A friend who has a card: their copies across its printings. */
export interface FriendCardCopies extends FriendUser {
  quantity: number
  printings: FriendCardPrinting[]
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

/** A printing on someone's wishlist. */
export interface WishlistItem {
  /** The printing's sync key; the same on every device, unlike `printing.id`. */
  pkey: string
  card: CardRow
  printing: Printing
  /** The card's original art, shown when the printing has no scan. */
  imageId: number
  /** As on EntryView: false for a friend's item seen from the desktop or phone app. */
  printingScan: boolean
  /** Copies wanted; null for no target, which never removes the row by itself. */
  quantity: number | null
  /** Copies of this printing in the list owner's collection. */
  owned: number
  unitPrice: number | null
  priceApproximate: boolean
  addedAt: string
}

/** A printing of one card on the wishlist. */
export interface CardWish {
  printingId: number
  quantity: number | null
}

/** The friends who own a wanted printing, by its sync key. */
export interface WishOwners {
  pkey: string
  friends: (FriendUser & { quantity: number })[]
}

/** A friend who wants a card, and which of its printings. */
export interface FriendWantsCard extends FriendUser {
  printings: { setCode: string; rarity: string; language: Language }[]
}

/** A binder in a list, with its progress. */
export interface BinderSummary {
  uid: string
  name: string
  goal: BinderGoal
  /** Empty means every language. */
  languages: Language[]
  friendsVisible: boolean
  hasRules: boolean
  /** False when this app can't read the binder's rules: it shows, but can't be saved. */
  editable: boolean
  ownedSlots: number
  missingSlots: number
  /** The rules match over MAX_BINDER_MATCHES printings, so there are no slots to show. */
  tooBroad: boolean
  coverImageId: number | null
}

/** One slot of a binder, owned or missing. */
export interface BinderCard {
  /** `${level}:${target}`. A pkey may hold colons, so split on the first colon only. */
  key: string
  level: BinderEditLevel
  card: CardRow
  /** The slot's art, or else the card's first; 0 when the card has none. */
  imageId: number
  printing: Printing | null
  /** As on EntryView: false for a friend's binder seen from the desktop or phone app. */
  printingScan: boolean
  owned: number
  added: boolean
  /** The cheapest known price of a missing slot; null when owned or unpriced. */
  price: number | null
}

export interface BinderDetail extends BinderSummary {
  rules: BinderRules
  cards: BinderCard[]
  valueToFinish: number
  unpricedMissing: number
}

/** What a draft's rules match, before any hand edits. */
export interface BinderPreview {
  printings: number
  cards: number
  /** Slots the draft's goal would count as owned. */
  owned: number
  tooBroad: boolean
}

/** A binder as seen from one card. */
export interface CardBinder {
  uid: string
  name: string
  inBinder: boolean
  /** The edit on this card, or else on one of its printings. */
  edit: BinderEditAction | null
}
