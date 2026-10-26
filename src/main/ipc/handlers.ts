import type Database from 'better-sqlite3'
import { ipcMain } from 'electron'
import type { Language } from '@shared/languages'
import type { CollectionFilters, EntryView, SyncStatus, UpdateStatus } from '@shared/types'
import type { INVOKE_CHANNELS } from '@shared/ipc'
import type { OcrBand } from '@shared/scan/types'
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
import type { FingerprintStore } from '../scan/fingerprints'
import type { Ocr } from '../scan/ocr'
import { matchName, printingsByCode, printingsForCards, printingsForSet } from '../repo/scan'
import { getStats, recordSnapshot } from '../repo/stats'
import type { PriceService } from '../prices/service'
import { needsPrice, refreshIntlPrices } from '../prices/refresh'
import { applyTcgPrices, refreshTcgPrices } from '../tcgplayer/prices'
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
  client,
  images,
  emitSync,
  app,
  window,
  prices,
  emitDataChanged,
  account,
  fingerprints,
  ocr
}: HandlerDeps): Handlers {
  // A copy from a set whose TCGplayer prices aren't kept yet gets them fetched. Then an owned printing (any
  // language) still without a price is looked up on eBay in the background; the renderer is told to refetch
  // once a lookup has finished. Signed in, eBay prices come from the account's server instead.
  const priceNewCopy = (printingId: number): void => {
    void (async () => {
      const tcg = await refreshTcgPrices(db, { version: app.version(), scope: 'owned' })
      if (applyTcgPrices(db, tcg.changedGroups) > 0) emitDataChanged()
      if (account.isSignedIn() || !needsPrice(db, printingId)) return
      await refreshIntlPrices(db, prices.client(), { printingIds: [printingId] })
      emitDataChanged()
    })().catch((e) => console.error('Pricing a new copy failed', e))
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
    'scan:printingsByCode': async (code: string) => printingsByCode(db, code),
    'scan:printingsForSet': async (setName: string) => printingsForSet(db, setName),
    'scan:printingsForCards': async (cardIds: number[]) => printingsForCards(db, cardIds),
    'scan:matchName': async (text: string) => matchName(db, text),
    'scan:fingerprints': () => fingerprints.read(),
    'scan:refreshFingerprints': () => fingerprints.refresh(),
    'scan:ocr': async (bands: OcrBand[], kind: 'code' | 'name') => {
      if (kind !== 'code' && kind !== 'name') throw new Error(`Unknown OCR kind: ${String(kind)}`)
      return ocr.read(bands, kind)
    },
    'stats:get': async () => getStats(db),
    'sets:list': async () => listSets(db),
    'sets:checklist': async (setName: string, language: Language) =>
      getChecklist(db, setName, checkLanguage(language)),
    'sets:adjust': async (
      setName: string,
      language: Language,
      printingId: number,
      delta: 1 | -1
    ) => {
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
