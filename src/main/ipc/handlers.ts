import type Database from 'better-sqlite3'
import { ipcMain } from 'electron'
import type { CollectionFilters, EntryView, UpdateStatus } from '@shared/types'
import type { INVOKE_CHANNELS } from '@shared/ipc'
import { INVOKE_CHANNELS as CHANNELS } from '@shared/ipc'
import type { ImageCache } from '../images/cache'
import { createDataHandlers } from './dataHandlers'
import type { ScanWindowManager } from '../scanWindow'
import type { FingerprintStore } from '../scan/fingerprints'
import { checkOcrBands, type Ocr } from '../scan/ocr'
import { cardLanguage } from '@shared/scan/cardLanguage'
import type { AccountService } from '../cloud/account'
import type { CatalogService } from '../catalog/service'
import { readPackWrappers } from '../images/packWrappers'

export interface WindowDeps {
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): boolean
}

export interface AppDeps {
  version(): string
  openDataFolder(): Promise<void>
  backupDatabase(): Promise<string | null>
  checkForUpdates(): Promise<UpdateStatus>
  applyUpdate(): Promise<void>
  updateStatus(): Promise<UpdateStatus>
}

export interface HandlerDeps {
  db: Database.Database
  images: ImageCache
  /** The card catalog's status; it's refreshed through the account. */
  catalog: Pick<CatalogService, 'status'>
  app: AppDeps
  window: WindowDeps
  scanWindow: Pick<ScanWindowManager, 'open' | 'isOpen' | 'toggleFullScreen'>
  account: AccountService
  fingerprints: FingerprintStore
  ocr: Ocr
}

export type Handlers = Record<
  (typeof INVOKE_CHANNELS)[number],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => Promise<unknown>
>

export function createHandlers({
  db,
  images,
  catalog,
  app,
  window,
  scanWindow,
  account,
  fingerprints,
  ocr
}: HandlerDeps): Handlers {
  return {
    ...createDataHandlers({ db, onEdit: () => account.noteLocalEdit() }),
    'friends:overview': async () => account.portal('friends:overview', []),
    'friends:request': async (username: string) => account.portal('friends:request', [username]),
    'friends:accept': async (userId: number) => account.portal('friends:accept', [userId]),
    'friends:ignore': async (userId: number) => account.portal('friends:ignore', [userId]),
    'friends:remove': async (userId: number) => account.portal('friends:remove', [userId]),
    'friends:block': async (userId: number) => account.portal('friends:block', [userId]),
    'friends:unblock': async (userId: number) => account.portal('friends:unblock', [userId]),
    // Printing ids differ between the server and this computer, so a friend's entries get no printing scans.
    'friends:collection': async (userId: number, f: CollectionFilters) =>
      (await account.portal<EntryView[]>('friends:collection', [userId, f])).map((e) => ({
        ...e,
        originalArt: false
      })),
    'friends:facets': async (userId: number) => account.portal('friends:facets', [userId]),
    'scan:fingerprints': () => fingerprints.read(),
    'scan:refreshFingerprints': () => fingerprints.refresh(),
    'scan:ocr': async (bands: unknown, kind: 'code' | 'name') => {
      if (kind !== 'code' && kind !== 'name') throw new Error(`Unknown OCR kind: ${String(kind)}`)
      checkOcrBands(bands)
      return ocr.read(bands, kind)
    },
    'scan:language': async (bands: unknown) => {
      checkOcrBands(bands)
      return cardLanguage(ocr, bands)
    },
    'prices:request': (printingIds: unknown) => account.requestPrices(printingIds),
    'usage:report': (events: unknown) => account.reportUsage(events),
    'rip:packWrappers': async (key: unknown) => {
      if (typeof key !== 'string') throw new Error('Pack image key must be a string')
      // Ahead of the queue, like the pack's own <img>: the pack waits on it.
      const file = await images.getSet(key, { priority: true })
      return file ? readPackWrappers(file) : null
    },
    'sync:status': async () => catalog.status(),
    'sync:run': async () => account.refreshCatalog(),
    'images:cacheSize': () => images.sizeBytes(),
    'images:clearCache': () => images.clear(),
    'window:minimize': async () => window.minimize(),
    'window:toggleMaximize': async () => window.toggleMaximize(),
    'window:close': async () => window.close(),
    'window:isMaximized': async () => window.isMaximized(),
    'scanWindow:open': async () => scanWindow.open(),
    'scanWindow:isOpen': async () => scanWindow.isOpen(),
    'scanWindow:toggleFullScreen': async () => scanWindow.toggleFullScreen(),
    'app:version': async () => app.version(),
    'app:openDataFolder': () => app.openDataFolder(),
    'app:backupDatabase': () => app.backupDatabase(),
    'app:checkForUpdates': () => app.checkForUpdates(),
    'app:applyUpdate': () => app.applyUpdate(),
    'app:updateStatus': () => app.updateStatus(),
    'account:status': async () => account.status(),
    'account:signIn': async () => account.signIn(),
    'account:signOut': async () => account.signOut(),
    'account:syncNow': async () => account.syncNow(),
    'account:deleteAccount': async () => {
      throw new Error('Delete your account from app.duelbinder.com')
    }
  }
}

export function registerIpc(handlers: Handlers): void {
  for (const channel of CHANNELS) {
    // Errors thrown by handlers propagate to the renderer as rejected promises.
    ipcMain.handle(channel, (_event, ...args) => handlers[channel](...args))
  }
}
