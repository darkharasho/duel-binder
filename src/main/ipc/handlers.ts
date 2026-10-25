import type Database from 'better-sqlite3'
import { ipcMain } from 'electron'
import type { Language } from '@shared/languages'
import type { SyncStatus, UpdateStatus } from '@shared/types'
import type { INVOKE_CHANNELS } from '@shared/ipc'
import { INVOKE_CHANNELS as CHANNELS } from '@shared/ipc'
import type { YgoClient } from '../ygo/client'
import type { ImageCache } from '../images/cache'
import { getSyncStatus, runSync } from '../sync/sync'
import { getCardDetail, searchCards } from '../repo/cards'
import { browseCards, browseFacets } from '../repo/browse'
import { checkLanguage, checkNotesLength } from '../repo/args'
import {
  addEntry,
  entriesForCard,
  getFacets,
  listEntries,
  removeEntry,
  updateEntry
} from '../repo/collection'
import { adjustPrinting, getChecklist, listSets } from '../repo/sets'
import { getStats, recordSnapshot } from '../repo/stats'
import type { PriceService } from '../prices/service'
import { needsPrice, refreshIntlPrices } from '../prices/refresh'
import type { AccountService } from '../cloud/account'

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
  client: YgoClient
  images: ImageCache
  emitSync: (s: SyncStatus) => void
  app: AppDeps
  window: WindowDeps
  prices: PriceService
  emitDataChanged: () => void
  account: AccountService
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handlers = Record<(typeof INVOKE_CHANNELS)[number], (...args: any[]) => Promise<unknown>>

export function createHandlers({
  db,
  client,
  images,
  emitSync,
  app,
  window,
  prices,
  emitDataChanged,
  account
}: HandlerDeps): Handlers {
  // An owned printing (any language) without a fresh eBay price is looked up in the background; the renderer is
  // told to refetch once the lookup has finished. Signed in, prices come from the account's server instead.
  const priceNewCopy = (printingId: number): void => {
    if (account.isSignedIn() || !needsPrice(db, printingId)) return
    void refreshIntlPrices(db, prices.client(), { printingIds: [printingId] }).then(() => emitDataChanged())
  }
  // Keep today's value snapshot meaning "end of day" as the collection changes.
  const snapshotAfter = <T>(result: T): T => {
    recordSnapshot(db)
    return result
  }
  // A write to the collection: the account syncs it shortly.
  const edited = <T>(result: T): T => {
    account.noteLocalEdit()
    return result
  }
  return {
    'cards:search': async (q: string) => searchCards(db, q),
    'cards:get': async (cardId: number) => getCardDetail(db, cardId),
    'cards:browse': async (f) => browseCards(db, f),
    'cards:browseFacets': async () => browseFacets(db),
    'collection:list': async (f) => listEntries(db, f),
    'collection:forCard': async (cardId: number) => entriesForCard(db, cardId),
    'collection:add': async (input) => {
      checkNotesLength(input)
      const entry = edited(snapshotAfter(addEntry(db, input)))
      priceNewCopy(entry.printing.id)
      return entry
    },
    'collection:update': async (id: number, patch) => {
      checkNotesLength(patch)
      const entry = edited(snapshotAfter(updateEntry(db, id, patch)))
      if (patch.printingId !== undefined) priceNewCopy(entry.printing.id)
      return entry
    },
    'collection:remove': async (id: number) => edited(snapshotAfter(removeEntry(db, id))),
    'collection:facets': async () => getFacets(db),
    'stats:get': async () => getStats(db),
    'sets:list': async () => listSets(db),
    'sets:checklist': async (setName: string, language: Language) =>
      getChecklist(db, setName, checkLanguage(language)),
    'sets:adjust': async (setName: string, language: Language, printingId: number, delta: 1 | -1) => {
      const result = edited(
        snapshotAfter(adjustPrinting(db, setName, checkLanguage(language), printingId, delta))
      )
      if (delta === 1) priceNewCopy(printingId)
      return result
    },
    'sync:status': async () => getSyncStatus(db),
    'sync:run': async () => {
      const status = await runSync(db, client, emitSync)
      if (status.state === 'idle') {
        recordSnapshot(db)
        account.catalogRefreshed()
      }
      return status
    },
    'prices:settings': async () => prices.settings(),
    'prices:setUrl': async (url: unknown) => {
      if (url !== null && typeof url !== 'string') throw new Error('Invalid address')
      const settings = prices.setUrl(url)
      // Re-check stale prices against the new address; the renderer refetches either way.
      // Signed in, the address isn't used: prices come from the account's server.
      if (!account.isSignedIn())
        void refreshIntlPrices(db, prices.client()).then(() => emitDataChanged())
      return settings
    },
    'images:cacheSize': () => images.sizeBytes(),
    'images:clearCache': () => images.clear(),
    'window:minimize': async () => window.minimize(),
    'window:toggleMaximize': async () => window.toggleMaximize(),
    'window:close': async () => window.close(),
    'window:isMaximized': async () => window.isMaximized(),
    'app:version': async () => app.version(),
    'app:openDataFolder': () => app.openDataFolder(),
    'app:backupDatabase': () => app.backupDatabase(),
    'app:checkForUpdates': () => app.checkForUpdates(),
    'app:applyUpdate': () => app.applyUpdate(),
    'app:updateStatus': () => app.updateStatus(),
    'account:status': async () => account.status(),
    'account:signIn': async () => account.signIn(),
    'account:signOut': async () => account.signOut(),
    'account:syncNow': async () => account.syncNow()
  }
}

export function registerIpc(handlers: Handlers): void {
  for (const channel of CHANNELS) {
    // Errors thrown by handlers propagate to the renderer as rejected promises.
    ipcMain.handle(channel, (_event, ...args) => handlers[channel](...args))
  }
}
