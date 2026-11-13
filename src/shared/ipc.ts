import type {
  AdminErrorGroup,
  AdminList,
  AdminMerge,
  AdminPhotos,
  AdminSkippedSignIn,
  AdminStats,
  AdminTester,
  AdminTesterBy,
  AdminWorkflow,
  GhJob,
  GhRun,
  RipFrameInfo
} from './admin'
import type { PlaceholderRequest } from './placeholders'
import type { ErrorDetails } from './errorReports'
import type { UsageCounts } from './usage'
import type { TrainingLabel, TrainingSend, TrainingSummary } from './training'
import type { Language } from './languages'
import type { ScanSession, ScanSessionCardDraft } from './scanSessions'
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
  PokedexSpecies,
  PokedexSummary,
  EntryView,
  Facets,
  FriendRequestResult,
  FriendCardCopies,
  FriendStats,
  FriendsOverview,
  FriendWantsCard,
  ImageDownloads,
  SetChecklist,
  SetNameEntry,
  SetSummary,
  SyncStatus,
  UpdateEntryInput,
  UpdateStatus,
  WishlistItem,
  WishOwners
} from './types'
import type { RipWindowMessage } from './ripWindow'
import type { ScanWindowMessage } from './scanWindow'
import type { ScanRef } from './scan/fingerprintRefs'
import type { FingerprintStatus, OcrBand, ScanPrinting } from './scan/types'
import type { EmailAuthView, EmailStep } from './emailAuth'
import type {
  AddEmailResult,
  EmailCodeResult,
  MergeChoice,
  SignInMethod,
  SignInProvider
} from './account'
import type { Me } from './cloud'
import type { CollectorNumber } from './scan/collectorNumber'
import type { DexPreview } from './dex/match'
import type { DexRow } from './dex/parse'
import type { CardLanguage } from './scan/language'
import type { OcrKind, TextModel } from './scan/ocr'
import type { GameId } from './games'
import type { BinderDraft, BinderEditAction, BinderTarget, RuleField } from './binders'

/** The API exposed to the renderer as `window.api`. */
export interface Api {
  cards: {
    search(q: string): Promise<CardSearchResult[]>
    get(cardId: number): Promise<CardDetail | null>
    /** One page of every card in the database. */
    browse(f: BrowseFilters): Promise<BrowsePage>
    /** Sets and rarities of the language, or of every language without one. */
    browseFacets(language?: Language): Promise<BrowseFacets>
    /** `[image id, the image id it shows]` of each card showing another card's art. */
    borrowedArt(): Promise<[number, number][]>
    traditionalArt(): Promise<[number, number][]>
    japaneseArt(): Promise<[number, number][]>
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
    /** An accepted friend's visible binders with progress against their collection; a portal without it answers 404. */
    binders(userId: number): Promise<BinderSummary[]>
    /** One of those binders with its cards; null if it is private or unknown. */
    binder(userId: number, uid: string): Promise<BinderDetail | null>
    /** An accepted friend's scan sessions they show, newest first (active game). */
    sessions(friendId: number): Promise<ScanSession[]>
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
  /** The scanner's Add to collection sessions, in the game shown: each keeps the prices it had when added. */
  sessions: {
    /** Records an Add's cards; each printing's pkey is looked up here, by its printing id. */
    record(s: { uid: string; game: GameId; cards: ScanSessionCardDraft[] }): Promise<void>
    /** Fills in prices still missing, then lists the game's sessions, newest first. */
    list(game: GameId): Promise<ScanSession[]>
    /** Hides a session from friends, or shows it again. */
    setHidden(uid: string, hidden: boolean): Promise<void>
    delete(uid: string): Promise<void>
    /** Takes one copy of a card out of a session (never the collection); the last card deletes it. */
    removeCard(uid: string, card: { pkey: string; imageId: number; addedAt: number }): Promise<void>
  }
  /** The cards this account hearted, in the game shown; private, so friends never see them. */
  favourites: {
    /** The favourite cards' ids. */
    list(): Promise<number[]>
    /** Hearts a card (`on`) or takes the heart off it. */
    set(cardId: number, on: boolean): Promise<void>
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
    /** Every Magic printing showing the look of one of these fingerprint ids, with its artIds. */
    printingsOfArt(imageIds: number[]): Promise<ScanPrinting[]>
    matchName(text: string): Promise<{ cardId: number; name: string; score: number } | null>
    /** The card of each artwork id that is in the catalog. */
    cardsForImages(imageIds: number[]): Promise<{ imageId: number; cardId: number }[]>
    /**
     * The Simplified Chinese printings of cards showing one of cardIds' art (the catalog's
     * English twin of a card with none of its own), each with the card whose art it shows.
     */
    chineseOfArt(cardIds: number[]): Promise<{ twinId: number; printing: ScanPrinting }[]>
    numberPrefixes(): Promise<string[]>
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
     * Admin scan trace: appends one frame's line (JSON, at most 8 KB) to the session's trace on
     * this computer, with the frame's JPEG when given. Refused for a non-admin account.
     */
    trace(session: string, line: string, jpeg?: ArrayBuffer): Promise<void>
    /** Admin: the folder scan traces are written to. */
    traceDir(): Promise<string>
    /** Admin: opens the scan trace folder. */
    openTraceDir(): Promise<void>
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
  /** The admin Rip capture tab's pop-out window: the camera alone, capturing; the tab drives it. */
  ripWindow: {
    open(): Promise<void>
    isOpen(): Promise<boolean>
    toggleFullScreen(): Promise<void>
    send(m: RipWindowMessage): void
    onMessage(cb: (m: RipWindowMessage) => void): () => void
    onOpenChange(cb: (open: boolean) => void): () => void
  }
  stats: {
    get(): Promise<CollectionStats>
  }
  pokedex: {
    summary(): Promise<PokedexSummary>
    species(dexNo: number): Promise<PokedexSpecies>
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
    /** Every set's name, language and code, for labelling set names: far smaller than `list`. */
    names(): Promise<SetNameEntry[]>
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
    /**
     * The phone only: `[local printing id, server id]` for those of these printings the server
     * knows, since a printing's photo is named by the server's id. Absent elsewhere.
     */
    photoIds?(printingIds: number[]): Promise<[number, number][]>
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
  /**
   * The desktop only: testers' training photos (Contribute photos), as the signed-in account. The
   * phone's screen calls its own store instead. None of these reject.
   */
  training?: {
    upload(clientId: string, label: TrainingLabel, jpeg: ArrayBuffer): Promise<TrainingSend>
    remove(clientId: string): Promise<TrainingSend>
    /** This account's photo counts for `game`; null signed out, offline or refused. */
    summary(game: GameId): Promise<TrainingSummary | null>
    /** `[local printing id, server id]` for those of these printings the server knows. */
    serverIds(printingIds: number[]): Promise<[number, number][]>
  }
  /**
   * The desktop only: the in-app admin pages, as the signed-in admin account (`Me.admin`). The web
   * and phone open the portal's /admin page instead (`account.openAdmin`). Each rejects for anyone
   * else, and like `account` calls when signed out or offline.
   */
  admin?: {
    /** Counts every table on the portal, so only read when asked. */
    stats(): Promise<AdminStats>
    errors(): Promise<AdminErrorGroup[]>
    /** A watched workflow's latest runs, newest first, from GitHub's public API. */
    runs(workflow: AdminWorkflow, perPage: number): Promise<GhRun[]>
    /** One run's jobs and their steps. */
    jobs(runId: number): Promise<GhJob[]>
    merges(): Promise<AdminMerge[]>
    /** Undoes a merge; the sign-ins it couldn't give back. */
    undoMerge(closedId: number): Promise<AdminSkippedSignIn[]>
    testers(): Promise<AdminTester[]>
    addTester(game: GameId, by: AdminTesterBy, name: string): Promise<void>
    removeTester(id: number): Promise<void>
    admins(): Promise<AdminList>
    addAdmin(username: string): Promise<void>
    removeAdmin(userId: number): Promise<void>
    photos(): Promise<AdminPhotos>
    /**
     * Rip capture: saves a key frame picked from a live pack opening under the app's data folder
     * (`rip-capture/<session>/<name>`, names as `RIP_SESSION` / `RIP_FRAME` in main); its path.
     */
    captureSave(session: string, name: string, jpeg: ArrayBuffer, info: RipFrameInfo): Promise<string>
    captureRemove(session: string, name: string): Promise<void>
    /** The owner's note on a session, saved beside its frames as note.txt ('' clears it). */
    captureNote(session: string, note: string): Promise<void>
    /** Opens a session's folder, or the capture folder for null. */
    captureOpenFolder(session: string | null): Promise<void>
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
    /** Asks where to save a Rip Replay and writes it there; the path, or null when cancelled. */
    saveReplay(name: string, data: Uint8Array): Promise<string | null>
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
    /** One email sign-in step; on `signed-in` the desktop is signed in and the token stays in the main process. */
    emailAuth(step: EmailStep, body: Record<string, unknown>): Promise<EmailAuthView>
    /** Links Discord (in the browser) to the email account a `match` step found. */
    emailLinkDiscord(ticket: string): Promise<EmailAuthView>
    /** Finishes `AccountStatus.claim` with the email account's password, or `null` for a separate account. */
    claim(password: string | null): Promise<EmailAuthView>
    /** Whether the portal has email sign-in on (false on any failure). */
    emailEnabled(): Promise<boolean>
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
    /** The signed-in account's sign-in methods, oldest first. */
    signIns(): Promise<SignInMethod[]>
    /** Sets the username (see `usernameProblem` for the rules); rejects with the reason it can't. */
    setUsername(name: string): Promise<Me>
    /** Removes a sign-in method; rejects for the account's last one. */
    removeSignIn(provider: SignInProvider): Promise<void>
    /** Stops suggesting to link another sign-in. */
    dismissLinkHint(): Promise<Me>
    /**
     * Adds an email sign-in: mails a code to the address (answers `code`), or, when another account
     * already signs in with it, checks `password` against that account and answers the link result.
     * Rejects when email sign-in is off.
     */
    addEmail(email: string, password: string): Promise<AddEmailResult>
    /** Confirms the mailed code and attaches the email (or the changed address) to the account. */
    confirmEmail(ticket: string, code: string): Promise<{ status: 'linked' }>
    /** Mails a fresh code for a pending add or change. */
    resendEmailCode(ticket: string): Promise<EmailCodeResult>
    /** Changes the email sign-in's password and signs out the account's other sessions. */
    changePassword(current: string, next: string): Promise<void>
    /** Starts changing the email address: mails a code to the new one, which stays unused until confirmed. */
    changeEmail(currentPassword: string, newEmail: string): Promise<EmailCodeResult>
    /**
     * Merges the account a link's merge ticket found into the signed-in one, and answers its `Me`.
     * Only the phone app has it; the desktop app and the web reject with `Not available here`.
     */
    merge(ticket: string, choice: MergeChoice): Promise<Me>
    /**
     * Opens the /admin dashboard, signed in, for the owner's account (`Me.admin`): the web goes to
     * the page, the desktop opens it in a window, the phone in an in-app browser. Rejects for anyone
     * else. `tab` opens one of its tabs (`ADMIN_TABS`); anything else opens its first.
     */
    openAdmin(tab?: AdminTab): Promise<void>
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
  'cards:japaneseArt',
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
  'friends:binders',
  'friends:binder',
  'friends:sessions',
  'friends:wanting',
  'friends:owning',
  'friends:wishlistVisible',
  'friends:setWishlistVisible',
  'wishlist:list',
  'wishlist:forCard',
  'wishlist:set',
  'wishlist:remove',
  'sessions:record',
  'sessions:list',
  'sessions:setHidden',
  'sessions:delete',
  'sessions:removeCard',
  'favourites:list',
  'favourites:set',
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
  'scan:printingsOfArt',
  'scan:matchName',
  'scan:cardsForImages',
  'scan:imagesForLanguage',
  'scan:chineseOfArt',
  'scan:numberPrefixes',
  'scan:fingerprints',
  'scan:fingerprintRefs',
  'scan:fingerprintStatus',
  'scan:refreshFingerprints',
  'scan:ocr',
  'scan:language',
  'scan:debugFrame',
  'scan:trace',
  'scan:traceDir',
  'scan:openTraceDir',
  'scan:readText',
  'scanWindow:open',
  'scanWindow:isOpen',
  'scanWindow:toggleFullScreen',
  'scanWindow:setSize',
  'ripWindow:open',
  'ripWindow:isOpen',
  'ripWindow:toggleFullScreen',
  'pokedex:summary',
  'pokedex:species',
  'stats:get',
  'prices:request',
  'sets:list',
  'sets:names',
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
  'training:upload',
  'training:remove',
  'training:summary',
  'training:serverIds',
  'errors:report',
  'errors:setEnabled',
  'app:version',
  'app:openDataFolder',
  'app:backupDatabase',
  'app:saveReplay',
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
  'account:emailAuth',
  'account:emailLinkDiscord',
  'account:claim',
  'account:emailEnabled',
  'account:syncNow',
  'account:unsynced',
  'account:deleteAccount',
  'account:signIns',
  'account:setUsername',
  'account:removeSignIn',
  'account:dismissLinkHint',
  'account:addEmail',
  'account:confirmEmail',
  'account:resendEmailCode',
  'account:changePassword',
  'account:changeEmail',
  'account:merge',
  'account:openAdmin',
  'admin:stats',
  'admin:errors',
  'admin:runs',
  'admin:jobs',
  'admin:merges',
  'admin:undoMerge',
  'admin:testers',
  'admin:addTester',
  'admin:removeTester',
  'admin:admins',
  'admin:addAdmin',
  'admin:removeAdmin',
  'admin:photos',
  'admin:captureSave',
  'admin:captureRemove',
  'admin:captureNote',
  'admin:captureOpenFolder'
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
export const RIP_WINDOW_MESSAGE = 'ripWindow:message' // payload: RipWindowMessage
export const RIP_WINDOW_OPEN = 'ripWindow:openChanged' // payload: boolean
export const RIP_WINDOW_SEND = 'ripWindow:send'

// Compile-time check: INVOKE_CHANNELS must list exactly the invoke methods of Api.
// Only methods returning a Promise count as invoke methods, so the event
// subscriptions (sync.onProgress, app.onUpdateStatus) are excluded by type.
type ApiInvokeChannel = {
  [N in keyof Api & string]: {
    [M in keyof NonNullable<Api[N]> & string]: NonNullable<Api[N]>[M] extends (
      ...args: never[]
    ) => Promise<unknown>
      ? `${N}:${M}`
      : never
  }[keyof NonNullable<Api[N]> & string]
}[keyof Api & string]
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export const invokeChannelsMatchApi: Equals<InvokeChannel, ApiInvokeChannel> = true

/** The /admin dashboard's tabs the apps link to, by their #id, in the dashboard's order. */
export const ADMIN_TABS = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'runs', label: 'Runs' },
  { tab: 'people', label: 'Users' },
  { tab: 'activity', label: 'Usage' },
  { tab: 'errors', label: 'Errors' },
  { tab: 'scanner', label: 'Scanner & prices' },
  { tab: 'testers', label: 'Testers' }
] as const
export type AdminTab = (typeof ADMIN_TABS)[number]['tab']

/** The dashboard link with `tab` as its #fragment, when it's one of `ADMIN_TABS`. */
export function adminTabUrl(url: string, tab: unknown): string {
  return ADMIN_TABS.some((t) => t.tab === tab) ? `${url.split('#')[0]}#${tab as string}` : url
}
