import type { PlaceholderRequest } from './placeholders'
import type { ErrorDetails } from './errorReports'
import type { UsageCounts } from './usage'
import type { Language } from './languages'
import type {
  AccountStatus,
  UnsyncedEntry,
  AddEntryInput,
  BrowseFacets,
  BrowseFilters,
  BrowsePage,
  CardDetail,
  CardSearchResult,
  BinderDetail,
  BinderPreview,
  BinderSummary,
  CardBinder,
  CardWish,
  ChecklistCard,
  CollectionFilters,
  CollectionStats,
  EntryView,
  Facets,
  FriendRequestResult,
  FriendCardCopies,
  FriendStats,
  FriendsOverview,
  FriendWantsCard,
  ImageDownloads,
  SetChecklist,
  SetSummary,
  SyncStatus,
  UpdateEntryInput,
  UpdateStatus,
  WishlistItem,
  WishOwners
} from './types'
import type { ScanWindowMessage } from './scanWindow'
import type { ScanRef } from './scan/fingerprintRefs'
import type { FingerprintStatus, OcrBand, ScanPrinting } from './scan/types'
import type { CollectorNumber } from './scan/collectorNumber'
import type { DexPreview } from './dex/match'
import type { DexRow } from './dex/parse'
import type { CardLanguage } from './scan/language'
import type { OcrKind, TextModel } from './scan/ocr'
import type { PackWrappers, RipCard, RipHistory, RipSessionDetail, RipSet } from './rip/types'
import type { GameId } from './games'
import type { BinderDraft, BinderEditAction, BinderTarget, RuleField } from './binders'

/** The API exposed to the renderer as `window.api`. */
export interface Api {
  cards: {
    search(q: string): Promise<CardSearchResult[]>
    get(cardId: number): Promise<CardDetail | null>
    /** One page of every card in the database. */
    browse(f: BrowseFilters): Promise<BrowsePage>
    browseFacets(): Promise<BrowseFacets>
    /** `[image id, the image id it shows]` of each card showing another card's art. */
    borrowedArt(): Promise<[number, number][]>
    traditionalArt(): Promise<[number, number][]>
  }
  collection: {
    list(f: CollectionFilters): Promise<EntryView[]>
    forCard(cardId: number): Promise<EntryView[]>
    add(input: AddEntryInput): Promise<EntryView>
    update(id: number, patch: UpdateEntryInput): Promise<EntryView>
    remove(id: number): Promise<void>
    facets(): Promise<Facets>
  }
  /** Desktop only: imports a Dex CSV export into the Pokémon collection. */
  dex: {
    preview(rows: DexRow[]): Promise<DexPreview>
    apply(rows: DexRow[]): Promise<{ copies: number }>
    /** The window's own clipboard API is denied by the app's permission rules. */
    copy(text: string): Promise<void>
  }
  /** Desktop only: a PDF of a set's binder placeholders. Null when the save dialog is cancelled. */
  placeholders: {
    save(request: PlaceholderRequest): Promise<string | null>
  }
  friends: {
    overview(): Promise<FriendsOverview>
    request(username: string): Promise<FriendRequestResult>
    accept(userId: number): Promise<void>
    ignore(userId: number): Promise<void>
    remove(userId: number): Promise<void>
    /** Also ends any friendship or request with them. */
    block(userId: number): Promise<void>
    unblock(userId: number): Promise<void>
    /** An accepted friend's live entries, notes always ''. */
    collection(userId: number, f: CollectionFilters): Promise<EntryView[]>
    facets(userId: number): Promise<Facets>
    /** An accepted friend's dashboard in the current game; a portal without it answers 404. */
    stats(userId: number): Promise<FriendStats>
    /** Every set in the current game, with an accepted friend's progress. */
    sets(userId: number): Promise<SetSummary[]>
    checklist(userId: number, setName: string, language: Language): Promise<SetChecklist | null>
    /** Friends with copies of this card in the current game; a portal without it answers 404. */
    forCard(cardId: number): Promise<FriendCardCopies[]>
    /** An accepted friend's wishlist, without what they already have; empty if they hide it. */
    wishlist(userId: number): Promise<WishlistItem[]>
    /** Friends who want this card and don't hide their wishlist. */
    wanting(cardId: number): Promise<FriendWantsCard[]>
    /** Which friends own these printings (sync keys), in one call; only those some friend owns. */
    owning(pkeys: string[]): Promise<WishOwners[]>
    /** Whether friends can see this account's wishlist. */
    wishlistVisible(): Promise<boolean>
    setWishlistVisible(visible: boolean): Promise<void>
  }
  /** The cards this account wants, in the game shown. Local first, like the collection. */
  wishlist: {
    list(): Promise<WishlistItem[]>
    forCard(cardId: number): Promise<CardWish[]>
    /** Wants a printing; `quantity` null for no target. A target is kept above the copies owned. */
    set(printingId: number, quantity: number | null): Promise<void>
    remove(printingId: number): Promise<void>
  }
  /** Named sets of cards defined by rules; progress counts what the collection holds. */
  binders: {
    list(): Promise<BinderSummary[]>
    get(uid: string): Promise<BinderDetail | null>
    preview(draft: BinderDraft): Promise<BinderPreview>
    /** Creates or replaces; returns the uid. */
    save(draft: BinderDraft): Promise<string>
    remove(uid: string): Promise<void>
    /** Adds or removes one card, art or printing by hand; null drops that edit. */
    edit(uid: string, target: BinderTarget, action: BinderEditAction | null): Promise<void>
    forCard(cardId: number): Promise<CardBinder[]>
    fieldValues(field: RuleField, q: string): Promise<string[]>
  }
  scan: {
    printingsByCode(code: string): Promise<ScanPrinting[]>
    /** Pokémon printings with this printed collector number (leading zeros ignored). */
    printingsByNumber(n: CollectorNumber): Promise<ScanPrinting[]>
    printingsForSet(setName: string, language: Language): Promise<ScanPrinting[]>
    printingsForCards(cardIds: number[]): Promise<ScanPrinting[]>
    matchName(text: string): Promise<{ cardId: number; name: string; score: number } | null>
    /** The card of each artwork id that is in the catalog. */
    cardsForImages(imageIds: number[]): Promise<{ imageId: number; cardId: number }[]>
    /** Every artwork of a card printed in the language, in the shown game. */
    imagesForLanguage(language: Language): Promise<number[]>
    fingerprints(game: GameId): Promise<ArrayBuffer | null>
    /**
     * Yu-Gi-Oh's fingerprint file's reference scans of art variants, with their printings as this
     * app's printing ids (see fingerprintRefs.ts); empty when there are none.
     */
    fingerprintRefs(): Promise<ScanRef[]>
    /** Where the game's fingerprint file stands, a download's progress included. */
    fingerprintStatus(game: GameId): Promise<FingerprintStatus>
    refreshFingerprints(game: GameId, opts?: { force?: boolean }): Promise<FingerprintStatus>
    ocr(bands: OcrBand[], kind: OcrKind): Promise<string[]>
    /** The language the card text on the bands reads as; null when it can't be told. */
    language(bands: OcrBand[]): Promise<CardLanguage | null>
    /** Dev builds: keeps a camera frame and what became of it, for replaying a live failure. */
    debugFrame(jpeg: ArrayBuffer, note: string): Promise<void>
    /**
     * The card text on each band as model reads it, unjudged: a Pokémon card's language is told
     * from one read per model (pokemonLanguageOfReads), never from the reads run together.
     */
    readText(bands: OcrBand[], model: TextModel): Promise<string[]>
  }
  scanWindow: {
    /** Opens the scan window, or brings it to the front. */
    open(): Promise<void>
    isOpen(): Promise<boolean>
    toggleFullScreen(): Promise<void>
    setSize(width: number, height: number): Promise<void>
    send(m: ScanWindowMessage): void
    onMessage(cb: (m: ScanWindowMessage) => void): () => void
    onOpenChange(cb: (open: boolean) => void): () => void
  }
  /** Simulated pack openings. Desktop only; never synced. */
  rip: {
    sets(): Promise<RipSet[]>
    start(setName: string, packCount: number): Promise<number>
    openPack(sessionId: number): Promise<RipCard[]>
    session(id: number): Promise<RipSessionDetail | null>
    history(opts?: { sessionOffset?: number }): Promise<RipHistory>
    /** Where the wrappers are in a set's pack photo (`packImageKey`); null when it shows one. */
    packWrappers(packImageKey: string): Promise<PackWrappers | null>
  }
  stats: {
    get(): Promise<CollectionStats>
  }
  prices: {
    /**
     * Asks for eBay prices for printings on screen that have none: the portal prices the non-English
     * ones about a minute later and a sync brings them in (`app.onDataChanged`). Fire and forget: does
     * nothing signed out, offline or on the web.
     */
    request(printingIds: number[]): Promise<void>
    /** Whether eBay prices are hidden on this device. */
    ebayHidden(): Promise<boolean>
    /** Hides eBay prices from every price and total on this device, or brings them back. */
    setEbayHidden(hidden: boolean): Promise<void>
  }
  sets: {
    list(): Promise<SetSummary[]>
    checklist(setName: string, language: Language): Promise<SetChecklist | null>
    adjust(
      setName: string,
      language: Language,
      printingId: number,
      delta: 1 | -1
    ): Promise<ChecklistCard>
  }
  sync: {
    status(): Promise<SyncStatus>
    run(): Promise<SyncStatus>
    onProgress(cb: (s: SyncStatus) => void): () => void
  }
  images: {
    cacheSize(): Promise<number>
    clearCache(): Promise<void>
    /** Art downloads under way, as they change; never fires on the web or the phone. */
    onDownloads(cb: (d: ImageDownloads) => void): () => void
  }
  window: {
    /** `process.platform`, for drawing the title bar the way the OS does. */
    platform: string
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizedChange(cb: (maximized: boolean) => void): () => void
  }
  usage: {
    /** Sends anonymous event totals; never rejects, and drops them when signed out or offline. */
    report(events: UsageCounts): Promise<void>
  }
  errors: {
    /** Sends an anonymous, scrubbed error report; never rejects, and drops it when signed out or offline. */
    report(details: ErrorDetails): Promise<void>
    /** Tells the desktop's main process the usage setting, which it can't read itself; a no-op elsewhere. */
    setEnabled(on: boolean): Promise<void>
  }
  app: {
    version(): Promise<string>
    openDataFolder(): Promise<void>
    backupDatabase(): Promise<string | null>
    checkForUpdates(): Promise<UpdateStatus>
    applyUpdate(): Promise<void>
    /** Current updater status; no network. */
    updateStatus(): Promise<UpdateStatus>
    onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
    /** Fired after background syncs change card or set data. */
    onDataChanged(cb: () => void): () => void
  }
  /** The game this device shows, remembered per device. */
  games: {
    /** The games the signed-in account may use (cached for offline use); signed out, `['ygo']`. */
    available(): Promise<GameId[]>
    /** The game shown: the remembered one when available, otherwise 'ygo'. */
    active(): Promise<GameId>
    /** Shows `g` from now on and reloads every page (`app.onDataChanged`); rejects a game not available. */
    setActive(g: GameId): Promise<void>
  }
  account: {
    status(): Promise<AccountStatus>
    /** Resolves when sign-in finishes or fails. */
    signIn(): Promise<AccountStatus>
    /** Also cancels a sign-in in progress. */
    signOut(): Promise<AccountStatus>
    syncNow(): Promise<AccountStatus>
    /** The shown account's entries that can't sync. */
    unsynced(): Promise<UnsyncedEntry[]>
    /**
     * Deletes the signed-in portal account and everything synced to it. The web signs out and
     * leaves the page; the desktop app rejects (delete from app.duelbinder.com instead).
     */
    deleteAccount(): Promise<void>
    onChange(cb: (s: AccountStatus) => void): () => void
  }
}

/** One `'ns:method'` string per invoke (request/response) method on Api. */
export const INVOKE_CHANNELS = [
  'cards:search',
  'cards:get',
  'cards:browse',
  'cards:browseFacets',
  'cards:borrowedArt',
  'cards:traditionalArt',
  'collection:list',
  'collection:forCard',
  'collection:add',
  'collection:update',
  'collection:remove',
  'collection:facets',
  'dex:preview',
  'dex:apply',
  'dex:copy',
  'placeholders:save',
  'friends:overview',
  'friends:request',
  'friends:accept',
  'friends:ignore',
  'friends:remove',
  'friends:block',
  'friends:unblock',
  'friends:collection',
  'friends:facets',
  'friends:stats',
  'friends:sets',
  'friends:checklist',
  'friends:forCard',
  'friends:wishlist',
  'friends:wanting',
  'friends:owning',
  'friends:wishlistVisible',
  'friends:setWishlistVisible',
  'wishlist:list',
  'wishlist:forCard',
  'wishlist:set',
  'wishlist:remove',
  'binders:list',
  'binders:get',
  'binders:preview',
  'binders:save',
  'binders:remove',
  'binders:edit',
  'binders:forCard',
  'binders:fieldValues',
  'scan:printingsByCode',
  'scan:printingsByNumber',
  'scan:printingsForSet',
  'scan:printingsForCards',
  'scan:matchName',
  'scan:cardsForImages',
  'scan:imagesForLanguage',
  'scan:fingerprints',
  'scan:fingerprintRefs',
  'scan:fingerprintStatus',
  'scan:refreshFingerprints',
  'scan:ocr',
  'scan:language',
  'scan:debugFrame',
  'scan:readText',
  'scanWindow:open',
  'scanWindow:isOpen',
  'scanWindow:toggleFullScreen',
  'scanWindow:setSize',
  'rip:sets',
  'rip:start',
  'rip:openPack',
  'rip:session',
  'rip:history',
  'rip:packWrappers',
  'stats:get',
  'prices:request',
  'sets:list',
  'sets:checklist',
  'sets:adjust',
  'sync:status',
  'sync:run',
  'images:cacheSize',
  'images:clearCache',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:isMaximized',
  'usage:report',
  'errors:report',
  'errors:setEnabled',
  'app:version',
  'app:openDataFolder',
  'app:backupDatabase',
  'app:checkForUpdates',
  'app:applyUpdate',
  'app:updateStatus',
  'games:available',
  'games:active',
  'games:setActive',
  'prices:ebayHidden',
  'prices:setEbayHidden',
  'account:status',
  'account:signIn',
  'account:signOut',
  'account:syncNow',
  'account:unsynced',
  'account:deleteAccount'
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

/** Event channels pushed from main to renderer. */
export const SYNC_PROGRESS = 'sync:progress'
export const UPDATE_STATUS = 'update:status'
export const IMAGE_DOWNLOADS = 'images:downloads' // payload: ImageDownloads
export const DATA_CHANGED = 'data:changed' // payload: void
export const WINDOW_MAXIMIZED = 'window:maximized' // payload: boolean
export const ACCOUNT_CHANGED = 'account:changed' // payload: AccountStatus
export const SCAN_WINDOW_MESSAGE = 'scanWindow:message' // payload: ScanWindowMessage
export const SCAN_WINDOW_OPEN = 'scanWindow:openChanged' // payload: boolean
/** Renderer to main, via `ipcRenderer.send`; main relays it to the other window. */
export const SCAN_WINDOW_SEND = 'scanWindow:send'

// Compile-time check: INVOKE_CHANNELS must list exactly the invoke methods of Api.
// Only methods returning a Promise count as invoke methods, so the event
// subscriptions (sync.onProgress, app.onUpdateStatus) are excluded by type.
type ApiInvokeChannel = {
  [N in keyof Api & string]: {
    [M in keyof Api[N] & string]: Api[N][M] extends (...args: never[]) => Promise<unknown>
      ? `${N}:${M}`
      : never
  }[keyof Api[N] & string]
}[keyof Api & string]
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export const invokeChannelsMatchApi: Equals<InvokeChannel, ApiInvokeChannel> = true
