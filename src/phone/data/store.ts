import type { SqlDb } from '../../main/db/sql'
import { backfillArtTwins } from '../../main/catalog/artTwinBackfill'
import { backfillSetSeries } from '../../main/catalog/seriesBackfill'
import type { ErrorReport } from '../../shared/errorReports'
import type { UsageReport } from '../../shared/usage'
import { deleteMeta, getMeta, setMeta } from '../../main/db/meta'
import { applyChanges, catalogCursorKey, finishApply } from '../../main/catalog/apply'
import {
  CloudAuthError,
  CloudOfflineError,
  createCloudClient,
  type CloudClient
} from '../../main/cloud/client'
import { syncedGames, syncOnce } from '../../main/cloud/engine'
import { activeGame, checkActiveGame, reportingMe, withGamesOf } from '../../main/cloud/activeGame'
import {
  accountState,
  activeOwner,
  adoptLocalData,
  adoptMergedData,
  applyPending,
  ensureAccount,
  hasLocalData,
  hasOwnerRows,
  setActiveOwner,
  syncIssueCount
} from '../../main/cloud/localSync'
import { createDataHandlers, DATA_CHANNELS, type DataChannel } from '../../main/ipc/dataHandlers'
import { awaitingPrices, checkPrintingIds, requestPrices } from '../../main/cloud/priceRequests'
import { PHONE_TABLES } from '../../shared/catalogFeed'
import { gamesOf, type Me } from '../../shared/cloud'
import { GAME_IDS, GAMES, type GameId } from '../../shared/games'
import { FRIENDS_SIGNED_OUT, OFFLINE_MESSAGE } from '../../shared/friends'
import type { PortalChannel } from '../../shared/portal'
import { decodeFingerprints } from '../../shared/scan/fingerprintFile'
import { parseFingerprintRefs, type ScanRef } from '../../shared/scan/fingerprintRefs'
import { scanRefs } from '../../main/repo/scanRefs'
import { readBody } from '../../shared/scan/readBody'
import type { FingerprintStatus } from '../../shared/scan/types'
import type { UnsyncedEntry } from '../../shared/types'
import {
  labelParams,
  trainingAnswer,
  type TrainingLabel,
  type TrainingSend,
  type TrainingSummary
} from '../../shared/training'
import { PHONE_FORMAT } from './phoneSchema'
import { localPrintings } from '../../main/repo/friendPrintings'

export type PhoneAccount = { state: 'signed-out' } | { state: 'signed-in'; user: Me }

export interface CatalogState {
  /** First run is done: the catalog is downloaded and the collection has synced once since. */
  filled: boolean
  /** Seq of the last catalog change applied. */
  cursor: number
  /** The server's newest catalog seq when last asked; null before the first page. */
  latest: number | null
  lastSyncAt: string | null
  dbVersion: string | null
}

/** Where one game's catalog download stands: the feed position it reached, of the newest. */
export interface CatalogProgress {
  game: GameId
  cursor: number
  latest: number
}

/** The catalog downloads still to finish, for the status line and the scanner. */
export interface CatalogStatus {
  /** The game downloading for the first time now, and how far it is (0–100; null before a page lands). */
  downloading: { game: GameId; percent: number | null } | null
  /** The account's games whose card data hasn't fully come down yet. */
  missing: GameId[]
}

export interface PhoneSyncState {
  /** The shown account's entries not yet on the server (adds, edits and removals). */
  waiting: number
  /** The shown account's entries the server can't take. */
  problems: number
  lastSyncedAt: string | null
  signedOut: boolean
}

export type { TrainingSend } from '../../shared/training'

export interface PhoneStore {
  account(): Promise<PhoneAccount>
  signIn(token: string, user: Me): Promise<void>
  /**
   * Stores the signed-in account's `me` as the portal just returned it (a new username, a dismissed
   * hint). A `me` of another account, or signed out, changes nothing.
   */
  updateUser(me: Me): Promise<void>
  signOut(): Promise<{ waiting: number }>
  deleteAccount(): Promise<void>
  catalog(): Promise<CatalogState>
  /**
   * First run: downloads the card data of the game shown (holding the serial queue, as nothing else
   * runs yet), then syncs the collection. The other games come down afterwards in updateCatalog.
   */
  fillCatalog(onProgress: (p: CatalogProgress) => void): Promise<void>
  /**
   * Downloads the games whose card data hasn't fully come down (at once), and every game's changes
   * (once a day, or when forced), in the background: each page is its own step in the serial queue,
   * so an add or a sync never waits for a whole download. One run at a time; a call during a run
   * joins it. Resolves whether anything changed.
   */
  updateCatalog(opts?: { force?: boolean }): Promise<boolean>
  catalogStatus(): Promise<CatalogStatus>
  /**
   * Syncs the shown account; `changed` tells whether anything the user can see may have changed,
   * `awaitingPrices` whether printings asked for a moment ago still wait for a price (sync again soon).
   */
  sync(): Promise<PhoneSyncState & { changed: boolean; awaitingPrices: boolean }>
  syncState(): Promise<PhoneSyncState>
  syncProblems(): Promise<UnsyncedEntry[]>
  invoke(channel: DataChannel, args: unknown[]): Promise<unknown>
  portal<T>(channel: PortalChannel, args: unknown[]): Promise<T>
  /** A portal call that doesn't wait for the serial queue, nor hold it up. */
  portalRead<T>(channel: PortalChannel, args: unknown[]): Promise<T>
  /** A one-time link that opens the /admin dashboard, for the owner's account (CloudClient.adminLink). */
  adminLink(): Promise<string>
  /**
   * Asks the portal to price the unpriced non-English printings among these (see requestPrices in
   * main/cloud/priceRequests); resolves how many it queued. Signed out, offline or failed: 0 (it
   * only rejects ids that aren't a list of whole numbers).
   */
  requestPrices(printingIds: number[]): Promise<number>
  /** Sends anonymous usage totals when signed in; drops them otherwise. Never rejects. */
  reportUsage(report: UsageReport): Promise<void>
  /** Sends an anonymous error report when signed in; drops it otherwise. Never rejects. */
  reportError(report: ErrorReport): Promise<void>
  fingerprints(game: GameId): Promise<ArrayBuffer | null>
  /** Yu-Gi-Oh's file's reference scans with this phone's printing ids; empty without them. */
  fingerprintRefs(): Promise<ScanRef[]>
  /**
   * `[this phone's printing id, the server's]` for those of these the catalog feed gave a server
   * id: the server's id names a printing's photo (/img/printing/<id>). Others are left out.
   */
  printingPhotoIds(printingIds: number[]): Promise<[number, number][]>
  /** `[the server's printing id, this phone's]` for those of these the catalog has (friendPrintings.ts). */
  localPrintingIds(serverIds: number[]): Promise<[number, number][]>
  fingerprintStatus(game: GameId): Promise<FingerprintStatus>
  refreshFingerprints(opts: { game: GameId; force?: boolean }): Promise<FingerprintStatus>
  /**
   * Sends one labelled training photo (idempotent per client id). These calls never wait for the
   * serial queue, so a catalog fill doesn't hold an upload; they never reject.
   */
  trainingUpload(clientId: string, label: TrainingLabel, jpeg: ArrayBuffer): Promise<TrainingSend>
  /** Deletes this account's training photo with that client id, if the server has it. */
  trainingDelete(clientId: string): Promise<TrainingSend>
  /** This account's training photo counts for game; null signed out, offline or refused. */
  trainingSummary(game: GameId): Promise<TrainingSummary | null>
}

/**
 * Keys in `phone_state`:
 * - `token`: the Bearer token; absent when signed out.
 * - `user`: the signed-in `Me` as JSON (kept after a sign-out, for the account's name).
 * - `format`: the phone data format (see PHONE_FORMAT).
 * - `catalog_loaded`: '1' once first run's download (the game shown) reached the end of its feed.
 * - `catalog_filled`: '1' once a sync has succeeded after that: first run is done.
 * - `catalog_done:<game>`: '1' once that game's download reached the end of its feed.
 * - `catalog_latest`: the server's newest catalog seq at the last page.
 * - `catalog_needs_finish`: '1' while committed card changes wait for the search index rebuild.
 */
type StateKey =
  | 'token'
  | 'user'
  | 'format'
  | 'catalog_loaded'
  | 'catalog_filled'
  | 'catalog_latest'
  | 'catalog_needs_finish'
  | `catalog_done:${GameId}`

const DAY_MS = 24 * 60 * 60 * 1000
/**
 * How long a fingerprint check holds. A check of an unchanged file is a 304, so this is short: a
 * catalog run's new art reaches the scanner within the hour.
 */
const FINGERPRINT_CHECK_MS = 60 * 60 * 1000
/** The revoke on sign-out is best effort and gives up after this long. */
const REVOKE_TIMEOUT_MS = 10_000
/** A portal call the user is waiting on (friends) gives up after this long. */
const PORTAL_TIMEOUT_MS = 15_000
/** A training photo is up to 8 MB, so its upload gets longer than the other training calls. */
const TRAINING_UPLOAD_TIMEOUT_MS = 60_000
const TRAINING_TIMEOUT_MS = 15_000
/** The `phone_files` row of a game's fingerprint file; Yu-Gi-Oh!'s keeps its original name. */
const fingerprintsName = (game: GameId): string =>
  game === 'ygo' ? 'fingerprints' : `fingerprints:${game}`
/** Which printings Yu-Gi-Oh's printing scans show (fingerprintRefs.ts), as JSON bytes. */
const FINGERPRINT_REFS = 'fingerprint-refs'

/** The catalog tables that are cleared when the phone's data format changes. */
const RESET_TABLES = PHONE_TABLES.filter(
  (t) => t !== 'cards' && t !== 'card_printings' && t !== 'card_images'
)

/**
 * The data channels that only read. They answer at once, even while a sync or a download waits on
 * the network; every other channel (the edits, and any new one) goes through the serial queue.
 */
const READ_CHANNELS: ReadonlySet<DataChannel> = new Set<DataChannel>([
  'cards:search',
  'cards:get',
  'cards:browse',
  'cards:browseFacets',
  'cards:borrowedArt',
  'cards:traditionalArt',
  'cards:japaneseArt',
  'collection:list',
  'collection:forCard',
  'collection:facets',
  'scan:printingsByCode',
  'scan:printingsByNumber',
  'scan:printingsForSet',
  'scan:printingsForCards',
  'scan:printingsOfArt',
  'scan:matchName',
  'scan:cardsForImages',
  'scan:imagesForLanguage',
  'scan:chineseOfArt',
  'scan:numberPrefixes',
  'stats:get',
  'sets:list',
  'sets:checklist',
  'account:unsynced',
  'games:available',
  'games:active',
  'prices:ebayHidden'
])

/**
 * The phone's data: the account, the card catalog downloaded from the portal's change feed, the
 * collection (through the desktop's data handlers) and its sync, and the scan fingerprints.
 *
 * Writes and network work (sign-in and out, account deletion, the catalog download and update,
 * sync, the fingerprint download and the edits) run through one serial queue, so a catalog fill,
 * a sync and an add never interleave. Reads don't wait for the queue: a slow connection mustn't
 * hold up the scanner or a page. A read runs only while no transaction is open (`inTransaction`,
 * when the database can tell), so it never lands between the statements of a write.
 */
export function createPhoneStore(deps: {
  /** `inTransaction` lets reads wait out an open transaction (see PhoneDb). */
  db: SqlDb & { inTransaction?(): boolean }
  portal: string
  fetch: typeof fetch
  now?: () => Date
}): PhoneStore {
  const { db } = deps
  // Called unbound: the browser's fetch throws "Illegal invocation" when called as a method of `deps`.
  const doFetch = deps.fetch
  const now = deps.now ?? (() => new Date())
  const base = deps.portal.replace(/\/+$/, '')
  const handlers = createDataHandlers({
    db,
    // Waiting edits are counted from the dirty rows; the caller decides when to sync.
    onEdit: () => {},
    availableGames: () => games(),
    // The phone Api reloads the pages after a switch.
    onGameChanged: () => {}
  })

  let queue: Promise<unknown> = Promise.resolve()
  /** The last data-channel write queued (an edit), settled; a game switch waits for it. */
  let edits: Promise<unknown> = Promise.resolve()
  /** Runs `fn` after every call queued before it, whatever their outcome. */
  function serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  /** Runs a read now, or as soon as no transaction is open; it never waits for the queue. */
  function read<T>(fn: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const attempt = (): void => {
        if (db.inTransaction?.()) {
          setTimeout(attempt, 0)
          return
        }
        try {
          resolve(fn())
        } catch (e) {
          reject(e)
        }
      }
      attempt()
    })
  }

  const getState = (key: StateKey): string | null =>
    (
      db.prepare('SELECT value FROM phone_state WHERE key = ?').get(key) as
        { value: string } | undefined
    )?.value ?? null
  const setState = (key: StateKey, value: string): void => {
    db.prepare(
      'INSERT INTO phone_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value)
  }
  const deleteState = (key: StateKey): void => {
    db.prepare('DELETE FROM phone_state WHERE key = ?').run(key)
  }

  const token = (): string | null => getState('token')
  const storedUser = (): Me | null => {
    const raw = getState('user')
    if (raw === null) return null
    try {
      return JSON.parse(raw) as Me
    } catch {
      return null
    }
  }

  /** The signed-in account's games, as its last `me` gave them; signed out, `['ygo']`. */
  const games = (): GameId[] => (token() === null ? ['ygo'] : gamesOf(storedUser()))
  /** Whether the game shown fell back to 'ygo' since the last sync reported; it counts as a change. */
  let gameReset = false
  /** After an account change: a game the account can't use stops being shown. */
  const recheckGame = (): void => {
    if (checkActiveGame(db, games())) gameReset = true
  }
  // Before any page reads: the stored game must be one this account may use.
  checkActiveGame(db, games())

  /** Carries unsent rows of accounts merged into `user` over to it; returns whether any were found. */
  const adoptMerged = (user: Me): boolean => {
    let found = false
    for (const from of user.mergedFrom ?? []) {
      if (from === user.id || !hasOwnerRows(db, from)) continue
      adoptMergedData(db, from, user.id, now().toISOString())
      found = true
    }
    return found
  }

  const formatCurrent = (): boolean => Number(getState('format') ?? 0) >= PHONE_FORMAT

  const client = (t: string, timeoutMs?: number): CloudClient =>
    createCloudClient({ baseUrl: base, token: t, fetch: doFetch, timeoutMs })

  /**
   * Signed in: a client with the stored token, whose every `me()` refreshes the stored account's
   * games. Signed out: CloudAuthError.
   */
  const signedInClient = (): CloudClient => {
    const t = token()
    if (t === null) throw new CloudAuthError('Not signed in')
    return reportingMe(client(t), (me) => {
      const user = storedUser()
      if (token() !== t || user?.id !== me.id) return
      db.transaction(() => adoptMerged(me))()
      const next = withGamesOf(user, me)
      if (next === null) return
      setState('user', JSON.stringify(next))
      recheckGame()
    })
  }

  /** The server no longer knows the token: forget it, keep every row and the user's name. */
  const serverSignedOut = (): void => {
    deleteState('token')
    recheckGame()
  }

  /**
   * A /api/training/ call with the stored token, outside the serial queue. A 401 signs the phone
   * out (unless another token was stored meanwhile); `ok` carries the body of a 200.
   */
  async function trainingCall(
    path: string,
    init: RequestInit & { headers?: Record<string, string> },
    timeoutMs: number
  ): Promise<TrainingSend> {
    const t = token()
    if (t === null) return { ok: false, retry: true, reason: 'signed-out' }
    let res: Response
    try {
      res = await doFetch(`${base}/api/training/${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${t}` },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch {
      return { ok: false, retry: true, reason: 'offline' }
    }
    if (res.status === 401 && token() === t) serverSignedOut()
    return trainingAnswer(res)
  }

  /** Runs a call to the portal; a 401 signs the phone out before the error goes on. */
  async function online<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof CloudAuthError) serverSignedOut()
      throw e
    }
  }

  function portalCall<T>(channel: PortalChannel, args: unknown[]): Promise<T> {
    return asAccount((c) => c.rpc<T>(channel, args, activeGame(db, games())))
  }

  /** Runs a portal call as the signed-in account, offline failures as OFFLINE_MESSAGE. */
  function asAccount<T>(call: (c: CloudClient) => Promise<T>): Promise<T> {
    return online(async () => {
      const t = token()
      if (t === null) throw new Error(FRIENDS_SIGNED_OUT)
      try {
        return await call(client(t, PORTAL_TIMEOUT_MS))
      } catch (e) {
        if (e instanceof CloudOfflineError) throw new CloudOfflineError(OFFLINE_MESSAGE)
        throw e
      }
    })
  }

  function syncStateNow(): PhoneSyncState {
    const owner = activeOwner(db)
    const waiting =
      owner === 0
        ? 0
        : Number(
            (
              db
                // An entry the server can't take counts only in `problems`.
                .prepare(
                  `SELECT COUNT(*) AS n FROM collection_entries e
                   WHERE e.owner_id = ? AND e.dirty = 1 AND NOT EXISTS (
                     SELECT 1 FROM sync_issues i WHERE i.owner_id = e.owner_id AND i.uid = e.uid)`
                )
                .get(owner) as { n: number }
            ).n
          )
    return {
      waiting,
      problems: owner === 0 ? 0 : syncIssueCount(db, owner),
      lastSyncedAt: owner === 0 ? null : accountState(db, owner).syncedAt,
      signedOut: token() === null
    }
  }

  /**
   * The data format changed: drop the catalog rows no collection entry uses and start the download
   * again from the beginning. Collection rows are never touched.
   */
  function resetOldFormat(): void {
    if (formatCurrent()) return
    db.transaction(() => {
      // The side tables go first: pokemon_cards references cards.
      for (const t of RESET_TABLES) db.exec(`DELETE FROM ${t}`)
      db.exec(`
        DELETE FROM card_printings WHERE id NOT IN (SELECT printing_id FROM collection_entries);
        DELETE FROM card_images WHERE image_id NOT IN (SELECT image_id FROM collection_entries);
        DELETE FROM cards WHERE id NOT IN (SELECT card_id FROM card_printings)
          AND id NOT IN (SELECT card_id FROM card_images);
      `)
      finishApply(db, { applied: 1, cardsChanged: true, imagesChanged: true })
      setMeta(db, 'catalog_cursor', '0')
      for (const g of GAME_IDS) if (g !== 'ygo') deleteMeta(db, `catalog_cursor:${g}` as const)
      for (const k of [
        'catalog_loaded',
        'catalog_filled',
        'catalog_latest',
        'catalog_needs_finish'
      ] as const)
        deleteState(k)
      for (const g of GAME_IDS) deleteState(doneKey(g))
      setState('format', String(PHONE_FORMAT))
    })()
  }

  /** Runs a step of a download: at once (first run, already in the queue) or queued (the background). */
  type Step = <T>(fn: () => T | Promise<T>) => Promise<T>
  const direct: Step = async (fn) => fn()

  const doneKey = (game: GameId): `catalog_done:${GameId}` => `catalog_done:${game}`
  const gameDone = (game: GameId): boolean => getState(doneKey(game)) !== null

  // A phone from before the per-game marks, whose download had finished: every game it pulled
  // reached the end of its feed then, so it isn't sent through a first download again.
  if (getState('catalog_loaded') !== null && !GAME_IDS.some(gameDone))
    db.transaction(() => {
      for (const g of GAME_IDS)
        if (getMeta(db, catalogCursorKey(g)) !== null) setState(doneKey(g), '1')
    })()

  /**
   * Downloads the change feed for the phone tables of one game from its cursor to the end (a game
   * never pulled starts from 0). The network waits happen outside `step`; each page lands in a step
   * of its own and commits with its cursor, so a failure resumes from the last page that landed and
   * whatever else is queued runs between pages. Foreign keys are off while a page lands: a page may
   * hold rows pointing at a row a later page brings (a card changed after its new printings is
   * listed at its later seq). Reads may run between pages, and see each page's rows whole. The
   * search index is rebuilt once the game's feed ends. Returns whether anything changed.
   */
  async function pullGame(
    c: CloudClient,
    game: GameId,
    step: Step,
    onProgress: (p: CatalogProgress) => void
  ): Promise<boolean> {
    let changed = false
    const key = catalogCursorKey(game)
    let cursor = Number(getMeta(db, key) ?? 0)
    for (;;) {
      const from = cursor
      const page = await c.catalogChanges(from, undefined, PHONE_TABLES, game)
      if (page.more && page.cursor <= from) throw new Error('The catalog feed stopped advancing')
      const landed = await step(() => {
        // A format reset moved the cursor meanwhile: this page belongs to the old download.
        if (Number(getMeta(db, key) ?? 0) !== from) return false
        db.exec('PRAGMA foreign_keys = OFF')
        try {
          db.transaction(() => {
            const r = applyChanges(db, page.changes)
            if (r.applied > 0) changed = true
            if (r.cardsChanged) setState('catalog_needs_finish', '1')
            setMeta(db, key, String(page.cursor))
            if (game === 'ygo') setState('catalog_latest', String(page.latest))
            if (page.dbVersion !== null) setMeta(db, 'db_version', page.dbVersion)
            if (!page.more) setState(doneKey(game), '1')
          })()
        } finally {
          db.exec('PRAGMA foreign_keys = ON')
        }
        return true
      })
      if (!landed) return changed
      cursor = page.cursor
      onProgress({ game, cursor, latest: page.latest })
      if (!page.more) break
    }
    await step(() => {
      db.transaction(() => {
        if (getState('catalog_needs_finish') !== null) {
          finishApply(db, { applied: 1, cardsChanged: true, imagesChanged: false })
          deleteState('catalog_needs_finish')
        }
        setMeta(db, 'last_sync_at', now().toISOString())
      })()
      // Entries pulled before the catalog had their printing can land now.
      if (changed) applyPending(db)
    })
    return changed
  }

  /** pullGame for each of `games` in turn, Pokémon's backfills first. Returns whether anything changed. */
  async function pullCatalog(
    c: CloudClient,
    games: readonly GameId[],
    step: Step,
    onProgress: (p: CatalogProgress) => void
  ): Promise<boolean> {
    let changed = false
    for (const game of games) {
      if (game === 'pkm')
        await step(async () => {
          await backfillArtTwins(db, (since) =>
            c.catalogChanges(since, undefined, ['pokemon_cards'], game)
          )
          await backfillSetSeries(db, (since) => c.catalogChanges(since, undefined, ['sets'], game))
        })
      if (await pullGame(c, game, step, onProgress)) changed = true
    }
    return changed
  }

  /** The background download under way (see updateCatalog), and the first download it is making. */
  let catalogRun: Promise<boolean> | null = null
  let downloading: { game: GameId; base: number; cursor: number; latest: number } | null = null

  /**
   * One sync of the shown account; a success after the catalog download finishes first run.
   * Resolves whether anything the user can see may have changed.
   */
  async function syncNow(c: CloudClient): Promise<boolean> {
    const owner = activeOwner(db)
    const { changed } = await syncOnce(db, owner, c, now)
    if (getState('catalog_loaded') !== null) setState('catalog_filled', '1')
    return changed
  }

  /** The fingerprint downloads under way, and their share arrived once it is known. */
  const downloads = new Map<GameId, number | undefined>()

  function fingerprintStatus(game: GameId, failed = false): FingerprintStatus {
    const row = db
      .prepare('SELECT bytes FROM phone_files WHERE name = ?')
      .get(fingerprintsName(game)) as { bytes: Uint8Array } | undefined
    if (row) {
      try {
        return { state: 'ready', count: decodeFingerprints(row.bytes).count }
      } catch {
        // A bad file counts as none; the next refresh downloads it again.
      }
    }
    return { state: failed ? 'error' : 'missing', count: 0 }
  }

  /** Resolves true when it stored a new file. */
  async function downloadFingerprints(game: GameId): Promise<boolean> {
    const known = db
      .prepare('SELECT etag FROM phone_files WHERE name = ?')
      .get(fingerprintsName(game)) as { etag: string | null } | undefined
    const headers: Record<string, string> =
      known?.etag && fingerprintStatus(game).state === 'ready'
        ? { 'If-None-Match': known.etag }
        : {}
    // A game not open to everyone has its file only for an account that may use it.
    const t = GAMES[game].access === 'everyone' ? null : token()
    if (t !== null) headers.authorization = `Bearer ${t}`
    const res = await doFetch(`${base}/scan/fingerprints${game === 'ygo' ? '' : `?game=${game}`}`, {
      headers,
      signal: AbortSignal.timeout(30_000)
    })
    if (res.status === 404) return false
    if (res.status === 304 && known) {
      db.prepare('UPDATE phone_files SET checked_at = ? WHERE name = ?').run(
        now().toISOString(),
        fingerprintsName(game)
      )
      return false
    }
    if (!res.ok) throw new Error(`Fingerprint download failed (${res.status})`)
    downloads.set(game, undefined)
    let bytes: Uint8Array
    try {
      bytes = await readBody(res, (share) => downloads.set(game, share))
    } finally {
      downloads.delete(game)
    }
    decodeFingerprints(bytes)
    db.prepare(
      `INSERT INTO phone_files (name, etag, checked_at, bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET etag = excluded.etag, checked_at = excluded.checked_at,
         bytes = excluded.bytes`
    ).run(fingerprintsName(game), res.headers.get('ETag'), now().toISOString(), bytes)
    return true
  }

  /**
   * Resolves true when it stored a new refs file. Only beside a fingerprint file; a portal
   * without one (404) or a bad one leaves the stored one as it is.
   */
  async function downloadFingerprintRefs(): Promise<boolean> {
    const known = db
      .prepare('SELECT etag FROM phone_files WHERE name = ?')
      .get(FINGERPRINT_REFS) as { etag: string | null } | undefined
    const res = await doFetch(`${base}/scan/fingerprint-refs`, {
      headers: known?.etag ? { 'If-None-Match': known.etag } : {},
      signal: AbortSignal.timeout(30_000)
    })
    const store = (etag: string | null, bytes: Uint8Array): void => {
      db.prepare(
        `INSERT INTO phone_files (name, etag, checked_at, bytes) VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET etag = excluded.etag, checked_at = excluded.checked_at,
           bytes = excluded.bytes`
      ).run(FINGERPRINT_REFS, etag, now().toISOString(), bytes)
    }
    if (!res.ok) {
      await res.body?.cancel()
      // None on the portal yet: an empty row says it was asked, so the next check asks again
      // rather than every refresh (see refreshFingerprints).
      if (res.status === 404 && !known) store(null, new Uint8Array())
      return false
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    parseFingerprintRefs(new TextDecoder().decode(bytes))
    store(res.headers.get('ETag'), bytes)
    return true
  }

  return {
    account: () =>
      read(() => {
        const user = storedUser()
        return token() !== null && user !== null
          ? { state: 'signed-in', user }
          : { state: 'signed-out' }
      }),

    signIn: (newToken, user) =>
      serial(() => {
        db.transaction(() => {
          ensureAccount(db, user.id, user.displayName ?? user.username)
          if (hasLocalData(db)) adoptLocalData(db, user.id)
          adoptMerged(user)
          setActiveOwner(db, user.id)
          // An account that never synced here pulls its entries before first run is done (see fillCatalog).
          if (accountState(db, user.id).syncedAt === null) deleteState('catalog_filled')
          setState('token', newToken)
          setState('user', JSON.stringify(user))
          recheckGame()
        })()
      }),

    updateUser: (me) =>
      serial(() => {
        if (token() === null || storedUser()?.id !== me.id) return
        db.transaction(() => {
          setState('user', JSON.stringify(me))
          ensureAccount(db, me.id, me.displayName ?? me.username)
          recheckGame()
        })()
      }),

    signOut: () =>
      serial(async () => {
        const old = token()
        if (old !== null) {
          try {
            await client(old, REVOKE_TIMEOUT_MS).revoke()
          } catch {
            // Best effort: offline, the token stays valid on the server until it expires.
          }
          deleteState('token')
          recheckGame()
        }
        return { waiting: syncStateNow().waiting }
      }),

    deleteAccount: () =>
      serial(async () => {
        const t = token()
        if (t === null) throw new CloudAuthError('Not signed in')
        let res: Response
        try {
          res = await doFetch(`${base}/api/account/delete`, {
            method: 'POST',
            headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
            body: JSON.stringify({ confirm: 'delete' }),
            redirect: 'error',
            signal: AbortSignal.timeout(30_000)
          })
        } catch (e) {
          throw new CloudOfflineError((e as Error | undefined)?.message || undefined)
        }
        if (res.status === 401) {
          serverSignedOut()
          throw new CloudAuthError()
        }
        if (res.status >= 500) throw new CloudOfflineError(`The portal failed (${res.status})`)
        if (!res.ok) throw new Error(`Account deletion failed (${res.status})`)
        const owner = activeOwner(db)
        db.transaction(() => {
          for (const table of [
            'collection_entries',
            'wishlist_entries',
            'binders',
            'binder_edits',
            'favourites',
            'scan_sessions',
            'value_snapshots',
            'sync_pending',
            'sync_issues',
            'cloud_accounts'
          ])
            db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).run(owner)
          setActiveOwner(db, 0)
          deleteState('token')
          deleteState('user')
          recheckGame()
        })()
      }),

    catalog: () =>
      read(() => {
        const latest = getState('catalog_latest')
        return {
          filled: formatCurrent() && getState('catalog_filled') !== null,
          cursor: Number(getMeta(db, 'catalog_cursor') ?? 0),
          latest: latest === null ? null : Number(latest),
          lastSyncAt: getMeta(db, 'last_sync_at'),
          dbVersion: getMeta(db, 'db_version')
        }
      }),

    fillCatalog: (onProgress) =>
      serial(() =>
        online(async () => {
          const c = signedInClient()
          resetOldFormat()
          // The game shown; the account's others come down in the background (updateCatalog).
          await pullGame(c, activeGame(db, games()), direct, onProgress)
          setState('catalog_loaded', '1')
          // The user's entries come down before the first scan, so an add raises a pulled entry.
          await syncNow(c)
        })
      ),

    updateCatalog: ({ force = false } = {}) => {
      catalogRun ??= online(async () => {
        if (token() === null) return false
        // The first download (or a fresh one after a data format change) runs here too, behind
        // the app: nothing waits on it.
        const first = !formatCurrent() || getState('catalog_loaded') === null
        if (first) await serial(() => resetOldFormat())
        const last = Date.parse(getMeta(db, 'last_sync_at') ?? '')
        // A game not fully down yet goes on at once. So does a game with no cards here yet (its
        // catalog wasn't up at the day's check), so new card data for a game reaches the phone on
        // the next launch.
        const pending = games().some(
          (g) =>
            !gameDone(g) ||
            db.prepare('SELECT 1 FROM cards WHERE game = ? LIMIT 1').get(g) === undefined
        )
        if (!first && !force && !pending && !Number.isNaN(last) && now().getTime() - last < DAY_MS)
          return false
        const c = signedInClient()
        const shown = activeGame(db, games())
        // The game shown first: it is the one the user is looking at.
        const order = [...(await syncedGames(c))].sort(
          (a, b) => Number(b === shown) - Number(a === shown)
        )
        const progress = (p: CatalogProgress): void => {
          // Only a game's first download shows; a day's few changes don't.
          downloading = gameDone(p.game)
            ? null
            : {
                game: p.game,
                base: downloading?.game === p.game ? downloading.base : p.cursor,
                cursor: p.cursor,
                latest: p.latest
              }
        }
        const head = order[0] === shown ? order.slice(0, 1) : []
        let changed = await pullCatalog(c, head, serial, progress)
        // The game shown is down: the user's entries come down next (a sync after this finishes
        // first run, see syncNow), then the other games.
        if (first && gameDone(shown))
          await serial(async () => {
            setState('catalog_loaded', '1')
            await syncNow(c)
          })
        if (await pullCatalog(c, order.slice(head.length), serial, progress)) changed = true
        return changed
      }).finally(() => {
        catalogRun = null
        downloading = null
      })
      return catalogRun
    },

    catalogStatus: () =>
      read(() => {
        const d = downloading
        const span = d ? d.latest - d.base : 0
        return {
          downloading: d
            ? {
                game: d.game,
                percent: span > 0 ? Math.round(((d.cursor - d.base) / span) * 100) : null
              }
            : null,
          missing: token() === null ? [] : games().filter((g) => !gameDone(g))
        }
      }),

    sync: () =>
      serial(async () => {
        let changed = false
        if (token() !== null) {
          try {
            changed = await online(() => syncNow(signedInClient()))
          } catch (e) {
            if (!(e instanceof CloudAuthError) && !(e instanceof CloudOfflineError)) throw e
          }
        }
        // A sign-out by the server, or a refreshed `me`, may have changed the game shown.
        if (gameReset) changed = true
        gameReset = false
        return { ...syncStateNow(), changed, awaitingPrices: awaitingPrices(db, now()) }
      }),

    syncState: () => read(syncStateNow),

    // The same handler as the account:unsynced data channel, so both always agree.
    syncProblems: () => read(() => handlers['account:unsynced']() as Promise<UnsyncedEntry[]>),

    invoke: (channel, args) => {
      if (!(DATA_CHANNELS as readonly string[]).includes(channel))
        return Promise.reject(new Error(`Unknown data channel: ${String(channel)}`))
      const run = (): Promise<unknown> => handlers[channel](...args)
      if (READ_CHANNELS.has(channel)) return read(run)
      // A game switch doesn't queue behind a sync or a download, which can take seconds and
      // kept the old game on screen with no sign of the switch. It waits only for the edits
      // queued before it, which act on the game shown when they were made.
      if (channel === 'games:setActive') return edits.then(() => read(run))
      const queued = serial(run)
      edits = queued.catch(() => {})
      return queued
    },

    portal: <T>(channel: PortalChannel, args: unknown[]) =>
      serial(() => portalCall<T>(channel, args)),

    portalRead: <T>(channel: PortalChannel, args: unknown[]) =>
      read(() => portalCall<T>(channel, args)),

    adminLink: () => read(() => asAccount((c) => c.adminLink())),

    reportUsage: async (report) => {
      const t = token()
      if (t === null) return
      try {
        await client(t, PORTAL_TIMEOUT_MS).usage(report)
      } catch {
        // Best effort: a lost batch only undercounts.
      }
    },

    reportError: async (report) => {
      const t = token()
      if (t === null) return
      try {
        await client(t, PORTAL_TIMEOUT_MS).errorReport(report)
      } catch {
        // Best effort, and an older portal has no such route.
      }
    },

    requestPrices: async (printingIds) => {
      const ids = checkPrintingIds(printingIds)
      return serial(async () => {
        const t = token()
        if (t === null) return 0
        try {
          return await online(() => requestPrices(db, client(t, PORTAL_TIMEOUT_MS), ids, now()))
        } catch {
          // Fire and forget: offline or a failed call asks again on the next view.
          return 0
        }
      })
    },

    fingerprints: (game) =>
      read(() => {
        const row = db
          .prepare('SELECT bytes FROM phone_files WHERE name = ?')
          .get(fingerprintsName(game)) as { bytes: Uint8Array } | undefined
        if (!row || fingerprintStatus(game).state !== 'ready') return null
        return row.bytes.slice().buffer as ArrayBuffer
      }),

    fingerprintRefs: () =>
      read(() => {
        const row = db
          .prepare('SELECT bytes FROM phone_files WHERE name = ?')
          .get(FINGERPRINT_REFS) as { bytes: Uint8Array } | undefined
        if (!row) return []
        try {
          return scanRefs(db, parseFingerprintRefs(new TextDecoder().decode(row.bytes)))
        } catch {
          return []
        }
      }),

    printingPhotoIds: async (printingIds) => {
      const ids = checkPrintingIds(printingIds)
      return read(() => {
        const get = db.prepare(
          'SELECT remote_id FROM card_printings WHERE id = ? AND remote_id IS NOT NULL'
        )
        const out: [number, number][] = []
        for (const id of ids) {
          const row = get.get(id) as { remote_id: number } | undefined
          if (row) out.push([id, row.remote_id])
        }
        return out
      })
    },

    localPrintingIds: async (serverIds) => {
      // Never throws on a bad id: a friend's page shouldn't fail over one; localPrintings skips it.
      const ids = Array.isArray(serverIds) ? serverIds : []
      return read(() => [...localPrintings(db, ids)])
    },

    fingerprintStatus: (game) =>
      read(() =>
        downloads.has(game)
          ? { state: 'downloading', count: 0, progress: downloads.get(game) }
          : fingerprintStatus(game)
      ),

    refreshFingerprints: ({ game, force = false }) =>
      serial(async () => {
        const checked = db
          .prepare('SELECT checked_at FROM phone_files WHERE name = ?')
          .get(fingerprintsName(game)) as { checked_at: string } | undefined
        const ready = fingerprintStatus(game).state === 'ready'
        // Printing scans, and so refs, are Yu-Gi-Oh's only.
        const hasRefs = game === 'ygo'
        if (
          !force &&
          ready &&
          checked &&
          now().getTime() - Date.parse(checked.checked_at) < FINGERPRINT_CHECK_MS
        ) {
          // A phone from before the refs (no row for them) gets them now, not at the next check.
          const asked = db.prepare('SELECT 1 FROM phone_files WHERE name = ?').get(FINGERPRINT_REFS)
          if (!hasRefs || asked) return fingerprintStatus(game)
          return (await downloadFingerprintRefs().catch(() => false))
            ? { ...fingerprintStatus(game), updated: true as const }
            : fingerprintStatus(game)
        }
        try {
          const wrote = await downloadFingerprints(game)
          // Extras: trouble with them leaves the fingerprints' state as it is.
          const wroteRefs =
            hasRefs && fingerprintStatus(game).state === 'ready'
              ? await downloadFingerprintRefs().catch(() => false)
              : false
          return wrote || wroteRefs
            ? { ...fingerprintStatus(game), updated: true as const }
            : fingerprintStatus(game)
        } catch {
          return fingerprintStatus(game, true)
        }
      }),

    trainingUpload: (clientId, label, jpeg) =>
      trainingCall(
        `photos/${encodeURIComponent(clientId)}?${labelParams(label)}`,
        { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg },
        TRAINING_UPLOAD_TIMEOUT_MS
      ),

    trainingDelete: (clientId) =>
      trainingCall(
        `photos/${encodeURIComponent(clientId)}`,
        { method: 'DELETE' },
        TRAINING_TIMEOUT_MS
      ),

    trainingSummary: async (game) => {
      const r = await trainingCall(
        `summary?game=${encodeURIComponent(game)}`,
        { method: 'GET' },
        TRAINING_TIMEOUT_MS
      )
      return r.ok ? r.summary : null
    }
  }
}
