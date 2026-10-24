import type { Language } from './languages'
import type {
  AddEntryInput,
  CardDetail,
  CardSearchResult,
  ChecklistCard,
  CollectionFilters,
  CollectionStats,
  EntryView,
  Facets,
  PriceSettings,
  SetChecklist,
  SetSummary,
  SyncStatus,
  UpdateEntryInput,
  UpdateStatus
} from './types'

/** The API exposed to the renderer as `window.api`. */
export interface Api {
  cards: {
    search(q: string): Promise<CardSearchResult[]>
    get(cardId: number): Promise<CardDetail | null>
  }
  collection: {
    list(f: CollectionFilters): Promise<EntryView[]>
    forCard(cardId: number): Promise<EntryView[]>
    add(input: AddEntryInput): Promise<EntryView>
    update(id: number, patch: UpdateEntryInput): Promise<EntryView>
    remove(id: number): Promise<void>
    facets(): Promise<Facets>
  }
  stats: {
    get(): Promise<CollectionStats>
  }
  sets: {
    list(): Promise<SetSummary[]>
    checklist(setName: string, language: Language): Promise<SetChecklist | null>
    adjust(setName: string, language: Language, printingId: number, delta: 1 | -1): Promise<ChecklistCard>
  }
  sync: {
    status(): Promise<SyncStatus>
    run(): Promise<SyncStatus>
    onProgress(cb: (s: SyncStatus) => void): () => void
  }
  prices: {
    settings(): Promise<PriceSettings>
    /** Saves an address ('' turns eBay prices off); null goes back to the built-in one. */
    setUrl(url: string | null): Promise<PriceSettings>
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
}

/** One `'ns:method'` string per invoke (request/response) method on Api. */
export const INVOKE_CHANNELS = [
  'cards:search',
  'cards:get',
  'collection:list',
  'collection:forCard',
  'collection:add',
  'collection:update',
  'collection:remove',
  'collection:facets',
  'stats:get',
  'sets:list',
  'sets:checklist',
  'sets:adjust',
  'sync:status',
  'sync:run',
  'prices:settings',
  'prices:setUrl',
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
  'app:updateStatus'
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

/** Event channels pushed from main to renderer. */
export const SYNC_PROGRESS = 'sync:progress'
export const UPDATE_STATUS = 'update:status'
export const DATA_CHANGED = 'data:changed' // payload: void
export const WINDOW_MAXIMIZED = 'window:maximized' // payload: boolean

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
