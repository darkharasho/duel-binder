import type Database from 'better-sqlite3'
import { ipcMain } from 'electron'
import type { SyncStatus, UpdateStatus } from '@shared/types'
import type { INVOKE_CHANNELS } from '@shared/ipc'
import { INVOKE_CHANNELS as CHANNELS } from '@shared/ipc'
import type { YgoClient } from '../ygo/client'
import type { ImageCache } from '../images/cache'
import { getSyncStatus, runSync } from '../sync/sync'
import { getCardDetail, searchCards } from '../repo/cards'
import {
  addEntry,
  entriesForCard,
  getFacets,
  listEntries,
  removeEntry,
  updateEntry
} from '../repo/collection'
import { getStats, recordSnapshot } from '../repo/stats'

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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handlers = Record<(typeof INVOKE_CHANNELS)[number], (...args: any[]) => Promise<unknown>>

export function createHandlers({ db, client, images, emitSync, app }: HandlerDeps): Handlers {
  return {
    'cards:search': async (q: string) => searchCards(db, q),
    'cards:get': async (cardId: number) => getCardDetail(db, cardId),
    'collection:list': async (f) => listEntries(db, f),
    'collection:forCard': async (cardId: number) => entriesForCard(db, cardId),
    'collection:add': async (input) => addEntry(db, input),
    'collection:update': async (id: number, patch) => updateEntry(db, id, patch),
    'collection:remove': async (id: number) => removeEntry(db, id),
    'collection:facets': async () => getFacets(db),
    'stats:get': async () => getStats(db),
    'sync:status': async () => getSyncStatus(db),
    'sync:run': async () => {
      const status = await runSync(db, client, emitSync)
      if (status.state === 'idle') recordSnapshot(db)
      return status
    },
    'images:cacheSize': () => images.sizeBytes(),
    'images:clearCache': () => images.clear(),
    'app:version': async () => app.version(),
    'app:openDataFolder': () => app.openDataFolder(),
    'app:backupDatabase': () => app.backupDatabase(),
    'app:checkForUpdates': () => app.checkForUpdates(),
    'app:applyUpdate': () => app.applyUpdate(),
    'app:updateStatus': () => app.updateStatus()
  }
}

export function registerIpc(handlers: Handlers): void {
  for (const channel of CHANNELS) {
    // Errors thrown by handlers propagate to the renderer as rejected promises.
    ipcMain.handle(channel, (_event, ...args) => handlers[channel](...args))
  }
}
