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
  ChecklistCard,
  CollectionFilters,
  CollectionStats,
  EntryView,
  Facets,
  FriendRequestResult,
  FriendsOverview,
  SetChecklist,
  SetSummary,
  SyncStatus,
  UpdateEntryInput,
  UpdateStatus
} from './types'
import type { ScanWindowMessage } from './scanWindow'
import type { FingerprintStatus, OcrBand, ScanPrinting } from './scan/types'
import type { CardLanguage } from './scan/language'

/** The API exposed to the renderer as `window.api`. */
export interface Api {
  cards: {
    search(q: string): Promise<CardSearchResult[]>
    get(cardId: number): Promise<CardDetail | null>
    /** One page of every card in the database. */
    browse(f: BrowseFilters): Promise<BrowsePage>
    browseFacets(): Promise<BrowseFacets>
  }
  collection: {
    list(f: CollectionFilters): Promise<EntryView[]>
    forCard(cardId: number): Promise<EntryView[]>
    add(input: AddEntryInput): Promise<EntryView>
    update(id: number, patch: UpdateEntryInput): Promise<EntryView>
    remove(id: number): Promise<void>
    facets(): Promise<Facets>
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
  }
  scan: {
    printingsByCode(code: string): Promise<ScanPrinting[]>
    printingsForSet(setName: string, language: Language): Promise<ScanPrinting[]>
    printingsForCards(cardIds: number[]): Promise<ScanPrinting[]>
    matchName(text: string): Promise<{ cardId: number; name: string; score: number } | null>
    /** The card of each artwork id that is in the catalog. */
    cardsForImages(imageIds: number[]): Promise<{ imageId: number; cardId: number }[]>
    fingerprints(): Promise<ArrayBuffer | null>
    refreshFingerprints(): Promise<FingerprintStatus>
    ocr(bands: OcrBand[], kind: 'code' | 'name'): Promise<string[]>
    /** The language the card text on the bands reads as; null when it can't be told. */
    language(bands: OcrBand[]): Promise<CardLanguage | null>
  }
  scanWindow: {
    /** Opens the scan window, or brings it to the front. */
    open(): Promise<void>
    isOpen(): Promise<boolean>
    toggleFullScreen(): Promise<void>
    send(m: ScanWindowMessage): void
    onMessage(cb: (m: ScanWindowMessage) => void): () => void
    onOpenChange(cb: (open: boolean) => void): () => void
  }
  stats: {
    get(): Promise<CollectionStats>
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
  'collection:list',
  'collection:forCard',
  'collection:add',
  'collection:update',
  'collection:remove',
  'collection:facets',
  'friends:overview',
  'friends:request',
  'friends:accept',
  'friends:ignore',
  'friends:remove',
  'friends:block',
  'friends:unblock',
  'friends:collection',
  'friends:facets',
  'scan:printingsByCode',
  'scan:printingsForSet',
  'scan:printingsForCards',
  'scan:matchName',
  'scan:cardsForImages',
  'scan:fingerprints',
  'scan:refreshFingerprints',
  'scan:ocr',
  'scan:language',
  'scanWindow:open',
  'scanWindow:isOpen',
  'scanWindow:toggleFullScreen',
  'stats:get',
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
  'app:version',
  'app:openDataFolder',
  'app:backupDatabase',
  'app:checkForUpdates',
  'app:applyUpdate',
  'app:updateStatus',
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
