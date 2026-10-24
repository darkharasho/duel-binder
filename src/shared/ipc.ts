import type {
  AddEntryInput,
  CardDetail,
  CardSearchResult,
  CollectionFilters,
  CollectionStats,
  EntryView,
  Facets,
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
  sync: {
    status(): Promise<SyncStatus>
    run(): Promise<SyncStatus>
    onProgress(cb: (s: SyncStatus) => void): () => void
  }
  images: {
    cacheSize(): Promise<number>
    clearCache(): Promise<void>
  }
  app: {
    version(): Promise<string>
    openDataFolder(): Promise<void>
    backupDatabase(): Promise<string | null>
    checkForUpdates(): Promise<UpdateStatus>
    applyUpdate(): Promise<void>
    onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
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
  'sync:status',
  'sync:run',
  'images:cacheSize',
  'images:clearCache',
  'app:version',
  'app:openDataFolder',
  'app:backupDatabase',
  'app:checkForUpdates',
  'app:applyUpdate'
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

/** Event channels pushed from main to renderer. */
export const SYNC_PROGRESS = 'sync:progress'
export const UPDATE_STATUS = 'update:status'

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
