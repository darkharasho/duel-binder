import type { BinderEditAction, BinderEditLevel } from './binders'
import { isGameId, type GameId } from './games'

/** Limits shared by the desktop sync client and the server's sync endpoints. */

/** Most entries one push may send. */
export const MAX_PUSH = 500
/** Most entries one pull returns, and most printing keys one price request may ask for. */
export const MAX_PULL = 1000
/** Longest notes an entry may hold, on desktop and server alike. */
export const MAX_NOTES = 2000
/** How far in the future a client timestamp may be before the server clamps it to server time. */
export const FUTURE_SKEW_MS = 600_000
/** The request header naming the game an RPC call is for; missing or empty means Yu-Gi-Oh!. */
export const GAME_HEADER = 'x-duel-game'

/** The signed-in user, as returned by the portal's `GET /api/me` and `POST /auth/desktop/token`. */
export interface Me {
  id: number
  username: string
  displayName: string | null
  avatarUrl: string | null
  /** Set only by `GET /api/me`, and only for the ADMIN_DISCORD_ID account. */
  admin?: true
  /** The games this account may use. Old servers leave it out, which means `['ygo']`. */
  games?: GameId[]
}

/**
 * The games an account may use, from its `me`: Yu-Gi-Oh! always, then the others it lists. Signed
 * out (null) or an old server's `me` (no `games`) means Yu-Gi-Oh! only.
 */
export function gamesOf(me: Me | null): GameId[] {
  const games = me?.games?.filter(isGameId) ?? []
  return games.includes('ygo') ? games : ['ygo', ...games]
}

/** One collection entry as the sync protocol carries it. Times are ISO 8601 in `toISOString()` form. */
export interface WireEntry {
  uid: string
  pkey: string
  imageId: number
  quantity: number
  notes: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** An entry from a pull, with the server sequence number it was last written at. */
export type PulledEntry = WireEntry & { seq: number }

export type PushResult =
  | { uid: string; status: 'applied' }
  /** The server kept its newer row for this uid. */
  | { uid: string; status: 'stale'; current: WireEntry }
  /** Another uid holds this printing+art and won; this uid is now a tombstone. */
  | { uid: string; status: 'merged'; winner: WireEntry }
  /** The server catalog lacks the pkey or image; the client retries later. */
  | { uid: string; status: 'unknown-printing' }
  /** The uid belongs to another account. */
  | { uid: string; status: 'rejected' }

export interface PushResponse {
  results: PushResult[]
}

export interface PullResponse {
  entries: PulledEntry[]
  cursor: number
  more: boolean
}

export interface WirePrice {
  pkey: string
  price: number | null
  listingCount: number
  checkedAt: string
}

export interface PricesResponse {
  prices: WirePrice[]
  /** The server's price_service_status. */
  status: string | null
}

/** One wishlist row as the sync protocol carries it; a user has one per printing, tombstones included. */
export interface WireWish {
  pkey: string
  game: GameId
  /** Copies wanted; null for no target. */
  quantity: number | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type WishPushResult =
  | { pkey: string; status: 'applied' }
  /** The server kept its newer row for this printing. */
  | { pkey: string; status: 'stale'; current: WireWish }
  /** The account can't use the row's game yet; the client keeps it and retries later. */
  | { pkey: string; status: 'skipped' }

export interface WishPullResponse {
  entries: WireWish[]
  cursor: number
  more: boolean
}

/** One binder as the sync protocol carries it; `rules`, `goal` and `languages` are opaque JSON text to the server. */
export interface WireBinder {
  uid: string
  game: GameId
  name: string
  rules: string
  goal: string
  languages: string
  friendsVisible: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** One card, art or printing added to or removed from a binder; keyed by binderEditKey. */
export interface WireBinderEdit {
  binderUid: string
  level: BinderEditLevel
  target: string
  game: GameId
  action: BinderEditAction
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type BinderPushResult =
  | { uid: string; status: 'applied' | 'skipped' }
  | { uid: string; status: 'stale'; current: WireBinder }

export type BinderEditPushResult =
  | { key: string; status: 'applied' | 'skipped' }
  | { key: string; status: 'stale'; current: WireBinderEdit }

/** What identifies a binder edit: the binder, the level and the target. */
export const binderEditKey = (e: Pick<WireBinderEdit, 'binderUid' | 'level' | 'target'>): string =>
  `${e.binderUid}\u001f${e.level}\u001f${e.target}`

export interface BinderPullResponse {
  entries: WireBinder[]
  cursor: number
  more: boolean
}

export interface BinderEditPullResponse {
  entries: WireBinderEdit[]
  cursor: number
  more: boolean
}

/** The highest copies-wanted count a wishlist row may hold. */
export const MAX_WANTED = 999

/** A server price change, numbered by the server's catalog clock. */
export interface PriceChange extends WirePrice {
  seq: number
}

/** One page of the price change feed (GET /api/sync/price-changes). */
export interface PriceChangesResponse {
  prices: PriceChange[]
  /** The last row's seq, or the caller's `since` when the page is empty. */
  cursor: number
  more: boolean
}

/** Most price changes one feed page carries. */
export const MAX_PRICE_CHANGES = 2000

/** Most printing keys one price request (POST /api/sync/price-requests) may send. */
export const MAX_PRICE_REQUEST = 200

/** The answer to a price request. */
export interface PriceRequestResponse {
  /** Printings newly queued for an eBay price; they show up in a sync about a minute later. */
  queued: number
  /** Some printings weren't queued because a daily request limit was reached. */
  capped: boolean
}

/** When the entry was last edited: the later of its update and delete times. */
export function editTime(e: Pick<WireEntry, 'updatedAt' | 'deletedAt'>): string {
  if (e.deletedAt === null) return e.updatedAt
  return Date.parse(e.deletedAt) > Date.parse(e.updatedAt) ? e.deletedAt : e.updatedAt
}

/** Same uid: a replaces b when its edit time is later, or equal with a a tombstone and b live. */
export function replaces(
  a: Pick<WireEntry, 'updatedAt' | 'deletedAt'>,
  b: Pick<WireEntry, 'updatedAt' | 'deletedAt'>
): boolean {
  const ta = Date.parse(editTime(a))
  const tb = Date.parse(editTime(b))
  return ta > tb || (ta === tb && a.deletedAt !== null && b.deletedAt === null)
}

/** Different uids on one printing+art: true when a is kept. Later edit time wins; on a tie the smaller uid wins. */
export function keepsKey(a: WireEntry, b: WireEntry): boolean {
  const ta = Date.parse(editTime(a))
  const tb = Date.parse(editTime(b))
  return ta > tb || (ta === tb && a.uid < b.uid)
}
