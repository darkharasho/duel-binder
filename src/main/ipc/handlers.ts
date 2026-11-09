import type Database from 'better-sqlite3'
import { clipboard, ipcMain } from 'electron'
import type { Language } from '@shared/languages'
import type {
  BinderDetail,
  BinderSummary,
  CollectionFilters,
  EntryView,
  FriendStats,
  SetChecklist,
  UpdateStatus,
  WishlistItem
} from '@shared/types'
import { MAX_DEX_ROWS, type DexRow } from '@shared/dex/parse'
import { checkPlaceholderRequest } from '@shared/placeholders'
import type { ScanSession } from '@shared/scanSessions'
import {
  friendBinder,
  friendBinders,
  friendChecklist,
  friendItem,
  friendSession,
  friendStats,
  serverIdsOf,
  type LocalPrintings
} from '@shared/friendPrintings'
import { localPrintings } from '../repo/friendPrintings'
import type { INVOKE_CHANNELS } from '@shared/ipc'
import { adminTabUrl, INVOKE_CHANNELS as CHANNELS } from '@shared/ipc'
import type { ImageCache } from '../images/cache'
import { createDataHandlers } from './dataHandlers'
import type { ScanWindowManager } from '../scanWindow'
import type { FingerprintStore } from '../scan/fingerprints'
import { checkOcrBands, type Ocr } from '../scan/ocr'
import { isOcrKind, isTextModel, readTexts } from '@shared/scan/ocr'
import { isGameId, type GameId } from '@shared/games'
import {
  CLIENT_ID_RE,
  MAX_TRAINING_PHOTO_BYTES,
  labelParams,
  readLabel,
  type TrainingLabel
} from '@shared/training'
import { checkPrintingIds } from '../cloud/priceRequests'
import { createAdminRuns, type AdminRuns } from '../adminRuns'
import type { RipCapture } from '../ripCapture'
import { adminHandlers } from './adminHandlers'
import type { Me } from '@shared/cloud'
import type { SignInProvider } from '@shared/account'
import type { EmailStep } from '@shared/emailAuth'
import { applyDexImport, previewDexImport } from '../repo/dexImport'
import { savePlaceholders } from '../placeholders'
import { scanRefs } from '../repo/scanRefs'
import { recordSnapshot } from '../repo/stats'
import { cardLanguage } from '@shared/scan/cardLanguage'
import type { AccountService } from '../cloud/account'
import type { MainErrorReports } from '../errorReports'
import type { CatalogService } from '../catalog/service'
import { saveDebugFrame } from '../scan/debugFrames'

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
  saveReplay(name: string, data: Uint8Array): Promise<string | null>
  checkForUpdates(): Promise<UpdateStatus>
  applyUpdate(): Promise<void>
  updateStatus(): Promise<UpdateStatus>
  /** Shows the /admin dashboard a one-time link opens (`AccountService.adminLink`). */
  openAdmin(url: string): Promise<void>
}

export interface HandlerDeps {
  db: Database.Database
  images: ImageCache
  /** The card catalog's status; it's refreshed through the account. */
  catalog: Pick<CatalogService, 'status'>
  app: AppDeps
  window: WindowDeps
  scanWindow: Pick<ScanWindowManager, 'open' | 'isOpen' | 'toggleFullScreen' | 'setSize'>
  /** The admin Rip capture tab's pop-out window; none in tests that don't need it. */
  ripWindow?: Pick<ScanWindowManager, 'open' | 'isOpen' | 'toggleFullScreen'>
  account: AccountService
  errorReports: Pick<MainErrorReports, 'setEnabled'>
  /** Tells every window that the data shown changed. */
  emitDataChanged(): void
  fingerprints: Record<GameId, FingerprintStore>
  ocr: Ocr
  /** The admin Runs tab's GitHub reads; a real one when not given. */
  adminRuns?: AdminRuns
  /** The admin Rip capture tab's key frames on disk. */
  ripCapture: RipCapture
}

/** A training photo from the renderer, checked as the portal would check it; null when it isn't one. */
export function checkTrainingUpload(
  clientId: unknown,
  label: unknown,
  jpeg: unknown,
  now = new Date()
): { clientId: string; label: TrainingLabel; jpeg: ArrayBuffer } | null {
  if (typeof clientId !== 'string' || !CLIENT_ID_RE.test(clientId)) return null
  if (label === null || typeof label !== 'object') return null
  let checked: TrainingLabel | null
  try {
    checked = readLabel(labelParams(label as TrainingLabel), now)
  } catch {
    return null
  }
  if (!checked) return null
  const bytes =
    jpeg instanceof ArrayBuffer
      ? jpeg
      : jpeg instanceof Uint8Array
        ? (jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer)
        : null
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_TRAINING_PHOTO_BYTES) return null
  return { clientId, label: checked, jpeg: bytes }
}

/** A renderer's parsed export, checked before it reaches the database. */
function dexRows(rows: unknown): DexRow[] {
  const text = ['locale', 'series', 'set', 'id', 'number', 'name', 'variant'] as const
  const ok =
    Array.isArray(rows) &&
    rows.length <= MAX_DEX_ROWS &&
    rows.every(
      (r) =>
        typeof r === 'object' &&
        r !== null &&
        text.every((k) => typeof r[k] === 'string') &&
        (r.quantity === null || (Number.isSafeInteger(r.quantity) && r.quantity >= 0))
    )
  if (!ok) throw new Error('Bad Dex rows')
  return rows as DexRow[]
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
  ripWindow,
  account,
  errorReports,
  emitDataChanged,
  fingerprints,
  ocr,
  adminRuns = createAdminRuns(),
  ripCapture
}: HandlerDeps): Handlers {
  const local = (serverIds: number[]): LocalPrintings => localPrintings(db, serverIds)
  return {
    ...createDataHandlers({
      db,
      onEdit: () => account.noteLocalEdit(),
      availableGames: () => account.games(),
      onGameChanged: emitDataChanged
    }),
    'placeholders:save': (request: unknown) => savePlaceholders(checkPlaceholderRequest(request)),
    'dex:preview': async (rows: unknown) => previewDexImport(db, dexRows(rows)),
    'dex:apply': async (rows: unknown) => {
      if (!account.games().includes('pkm'))
        throw new Error('Pokémon is not available on this account')
      const result = applyDexImport(db, dexRows(rows))
      recordSnapshot(db)
      account.noteLocalEdit()
      return result
    },
    'dex:copy': async (text: unknown) => {
      if (typeof text !== 'string') throw new Error('Bad text')
      clipboard.writeText(text)
    },
    'friends:overview': async () => account.portal('friends:overview', []),
    'friends:request': async (username: string) => account.portal('friends:request', [username]),
    'friends:accept': async (userId: number) => account.portal('friends:accept', [userId]),
    'friends:ignore': async (userId: number) => account.portal('friends:ignore', [userId]),
    'friends:remove': async (userId: number) => account.portal('friends:remove', [userId]),
    'friends:block': async (userId: number) => account.portal('friends:block', [userId]),
    'friends:unblock': async (userId: number) => account.portal('friends:unblock', [userId]),
    // A friend's printing ids are the server's: each is looked up in this catalog (friendPrintings.ts).
    'friends:collection': async (userId: number, f: CollectionFilters) => {
      const entries = await account.portal<EntryView[]>('friends:collection', [userId, f])
      const ids = local(serverIdsOf.items(entries))
      return entries.map((e) => friendItem(e, ids))
    },
    'friends:facets': async (userId: number) => account.portal('friends:facets', [userId]),
    'friends:stats': async (userId: number) => {
      const s = await account.portal<FriendStats>('friends:stats', [userId])
      return friendStats(s, local(serverIdsOf.stats(s)))
    },
    'friends:sets': async (userId: number) => account.portal('friends:sets', [userId]),
    'friends:checklist': async (userId: number, setName: string, language: Language) => {
      const s = await account.portal<SetChecklist | null>('friends:checklist', [
        userId,
        setName,
        language
      ])
      return s && friendChecklist(s, local(serverIdsOf.checklist(s)))
    },
    'friends:forCard': async (cardId: number) => account.portal('friends:forCard', [cardId]),
    'friends:wishlist': async (userId: number) => {
      const items = await account.portal<WishlistItem[]>('friends:wishlist', [userId])
      const ids = local(serverIdsOf.items(items))
      return items.map((w) => friendItem(w, ids))
    },
    'friends:binders': async (userId: number) => {
      const bs = await account.portal<BinderSummary[]>('friends:binders', [userId])
      return friendBinders(bs, local(serverIdsOf.binders(bs)))
    },
    'friends:sessions': async (friendId: number) => {
      const sessions = await account.portal<ScanSession[]>('friends:sessions', [friendId])
      const ids = local(serverIdsOf.sessions(sessions))
      return sessions.map((s) => friendSession(s, ids))
    },
    'friends:binder': async (userId: number, uid: string) => {
      const b = await account.portal<BinderDetail | null>('friends:binder', [userId, uid])
      return b && friendBinder(b, local(serverIdsOf.binder(b)))
    },
    'friends:wanting': async (cardId: number) => account.portal('friends:wanting', [cardId]),
    'friends:owning': async (pkeys: string[]) => account.portal('friends:owning', [pkeys]),
    'friends:wishlistVisible': async () => account.portal('friends:wishlistVisible', []),
    'friends:setWishlistVisible': async (visible: boolean) =>
      account.portal('friends:setWishlistVisible', [visible]),
    'scan:fingerprints': (game: GameId) => fingerprints[game].read(),
    'scan:fingerprintRefs': async () => {
      const file = await fingerprints.ygo.readRefs()
      return file ? scanRefs(db, file) : []
    },
    'scan:fingerprintStatus': async (game: GameId) => fingerprints[game].status(),
    'scan:refreshFingerprints': (game: GameId, opts?: { force?: boolean }) =>
      fingerprints[game].refresh(opts),
    'scan:ocr': async (bands: unknown, kind: unknown) => {
      if (!isOcrKind(kind)) throw new Error(`Unknown OCR kind: ${String(kind)}`)
      checkOcrBands(bands)
      return ocr.read(bands, kind)
    },
    'scan:language': async (bands: unknown) => {
      checkOcrBands(bands)
      return cardLanguage(ocr, bands)
    },
    'scan:debugFrame': async (jpeg: unknown, note: unknown) => {
      if (!(jpeg instanceof ArrayBuffer) || typeof note !== 'string')
        throw new Error('Bad debug frame')
      await saveDebugFrame(jpeg, note)
    },
    'scan:readText': async (bands: unknown, model: unknown) => {
      if (!isTextModel(model)) throw new Error(`Unknown OCR model: ${String(model)}`)
      checkOcrBands(bands)
      return readTexts(ocr, bands, model)
    },
    'prices:request': (printingIds: unknown) => account.requestPrices(printingIds),
    'usage:report': (events: unknown) => account.reportUsage(events),
    'training:upload': async (clientId: unknown, label: unknown, jpeg: unknown) => {
      const checked = checkTrainingUpload(clientId, label, jpeg)
      if (!checked) return { ok: false, retry: false, reason: 'rejected' } as const
      return account.training((c) =>
        c.trainingUpload(checked.clientId, checked.label, checked.jpeg)
      )
    },
    'training:remove': async (clientId: unknown) => {
      if (typeof clientId !== 'string' || !CLIENT_ID_RE.test(clientId))
        return { ok: false, retry: false, reason: 'rejected' } as const
      return account.training((c) => c.trainingDelete(clientId))
    },
    'training:summary': async (game: unknown) => {
      if (typeof game !== 'string' || !isGameId(game)) return null
      const r = await account.training((c) => c.trainingSummary(game))
      return r.ok ? r.summary : null
    },
    'training:serverIds': async (printingIds: unknown) => {
      const get = db.prepare(
        'SELECT remote_id FROM card_printings WHERE id = ? AND remote_id IS NOT NULL'
      )
      const out: [number, number][] = []
      for (const id of checkPrintingIds(printingIds)) {
        const row = get.get(id) as { remote_id: number } | undefined
        if (row) out.push([id, row.remote_id])
      }
      return out
    },
    'errors:report': (details: unknown) => account.reportError(details),
    'errors:setEnabled': async (on: unknown) => errorReports.setEnabled(on === true),
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
    'ripWindow:open': async () => ripWindow?.open(),
    'ripWindow:isOpen': async () => ripWindow?.isOpen() ?? false,
    'ripWindow:toggleFullScreen': async () => ripWindow?.toggleFullScreen(),
    'scanWindow:setSize': async (width: number, height: number) => {
      if (Number.isFinite(width) && Number.isFinite(height)) scanWindow.setSize(width, height)
    },
    'app:version': async () => app.version(),
    'app:openDataFolder': () => app.openDataFolder(),
    'app:backupDatabase': () => app.backupDatabase(),
    'app:saveReplay': async (name: unknown, data: unknown) => {
      // Only a plain replay file name: the dialog picks the folder, the renderer never does.
      if (
        typeof name !== 'string' ||
        !/^[\w.-]+\.(mp4|webm|gif)$/.test(name) ||
        name.startsWith('.')
      )
        throw new Error('Not a replay file name')
      if (!(data instanceof Uint8Array)) throw new Error('Not replay bytes')
      return app.saveReplay(name, data)
    },
    'app:checkForUpdates': () => app.checkForUpdates(),
    'app:applyUpdate': () => app.applyUpdate(),
    'app:updateStatus': () => app.updateStatus(),
    'account:status': async () => account.status(),
    'account:signIn': async () => account.signIn(),
    'account:signOut': async () => account.signOut(),
    'account:emailAuth': async (step: EmailStep, body: Record<string, unknown>) =>
      account.emailAuth(step, body),
    'account:emailLinkDiscord': async (ticket: string) => account.emailLinkDiscord(ticket),
    'account:claim': async (password: string | null) => account.claim(password),
    'account:emailEnabled': async () => account.emailEnabled(),
    'account:syncNow': async () => account.syncNow(),
    'account:deleteAccount': async () => {
      throw new Error('Delete your account from app.duelbinder.com')
    },
    'account:openAdmin': async (tab?: unknown) =>
      app.openAdmin(adminTabUrl(await account.adminLink(), tab)),
    ...adminHandlers(account, adminRuns, ripCapture),
    'account:signIns': async () => account.portal('account:signIns', []),
    'account:setUsername': async (name: string) => {
      const me = await account.portal<Me>('account:setUsername', [name])
      account.updateUser(me)
      return me
    },
    'account:removeSignIn': async (provider: SignInProvider) =>
      account.portal('account:removeSignIn', [provider]),
    'account:dismissLinkHint': async () => {
      const me = await account.portal<Me>('account:dismissLinkHint', [])
      account.updateUser(me)
      return me
    },
    'account:addEmail': async (email: string, password: string) =>
      account.portal('account:addEmail', [email, password]),
    'account:confirmEmail': async (ticket: string, code: string) =>
      account.portal('account:confirmEmail', [ticket, code]),
    'account:resendEmailCode': async (ticket: string) =>
      account.portal('account:resendEmailCode', [ticket]),
    'account:changePassword': async (current: string, next: string) =>
      account.portal('account:changePassword', [current, next]),
    'account:changeEmail': async (currentPassword: string, newEmail: string) =>
      account.portal('account:changeEmail', [currentPassword, newEmail]),
    'account:merge': async () => {
      throw new Error('Not available here')
    }
  }
}

export function registerIpc(handlers: Handlers): void {
  for (const channel of CHANNELS) {
    // Errors thrown by handlers propagate to the renderer as rejected promises.
    ipcMain.handle(channel, (_event, ...args) => handlers[channel](...args))
  }
}
