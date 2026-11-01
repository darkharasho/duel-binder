import type { Api, InvokeChannel } from '../../../src/shared/ipc'
import type { PortalChannel } from '../../../src/shared/portal'
import type { BrowseFilters, CollectionFilters } from '../../../src/shared/types'
import type { Scope } from '../../../src/main/repo/scope'
import {
  checkAddInput,
  checkDelta,
  checkId,
  checkLanguage,
  checkNotesLength,
  checkObject,
  checkString,
  checkUpdatePatch
} from '../../../src/main/repo/args'
import { borrowedArt, getCardDetail, searchCards } from '../../../src/main/repo/cards'
import { browseCards, browseFacets } from '../../../src/main/repo/browse'
import {
  CollectionError,
  addEntry,
  entriesForCard,
  getFacets,
  listEntries,
  removeEntry,
  updateEntry
} from '../../../src/main/repo/collection'
import { adjustPrinting, getChecklist, listSets } from '../../../src/main/repo/sets'
import { getStats, recordSnapshot } from '../../../src/main/repo/stats'
import {
  listWishlist,
  removeWish,
  setWish,
  settleWishlist,
  wishesForCard
} from '../../../src/main/repo/wishlist'
import type { AppDeps } from './app'
import { currentUser, gamesFor } from './auth'
import {
  FriendError,
  acceptFriend,
  areFriends,
  blockUser,
  friendsOverview,
  ignoreFriend,
  removeFriend,
  requestFriend,
  unblockUser
} from './friends'
import { friendStats, friendsWithCard } from './friendCards'
import {
  friendWishlist,
  friendsOwning,
  friendsWanting,
  setWishlistVisible,
  wishlistVisible
} from './wishlist'
import { userScope } from './scope'
import { GAME_HEADER } from '../../../src/shared/cloud'
import type { GameId } from '../../../src/shared/games'

type Params<T> = T extends (...args: infer A) => unknown ? A : never

type ChannelMethod<C extends InvokeChannel> = C extends `${infer N}:${infer M}`
  ? N extends keyof Api
    ? M extends keyof Api[N]
      ? Api[N][M]
      : never
    : never
  : never

type RpcDeps = AppDeps & { userId: number; game: GameId }

type Handler<C extends InvokeChannel> = (
  deps: RpcDeps,
  scope: Scope,
  ...args: Params<ChannelMethod<C>>
) => unknown

/** The validated id of an accepted friend of `me`; anyone else is refused. */
function friendId(db: AppDeps['db'], me: number, id: unknown): number {
  const friend = checkId(id, 'userId')
  if (!areFriends(db, me, friend)) throw new FriendError("You aren't friends with this user")
  return friend
}

// Arguments come off the wire untyped: every handler checks its own before use.
const HANDLERS: { [C in PortalChannel]: Handler<C> } = {
  'cards:search': ({ db }, scope, q) => searchCards(db, checkString(q, 'q'), undefined, scope),
  'cards:get': ({ db }, scope, cardId) => getCardDetail(db, checkId(cardId, 'cardId'), scope),
  'cards:browse': ({ db }, scope, f) =>
    browseCards(db, checkObject(f, 'Filters') as unknown as BrowseFilters, scope),
  'cards:browseFacets': ({ db }, scope) => browseFacets(db, scope),
  'cards:borrowedArt': ({ db }) => borrowedArt(db),
  'sets:list': ({ db }, scope) => listSets(db, scope),
  'sets:checklist': ({ db }, scope, setName, language) =>
    getChecklist(db, checkString(setName, 'setName'), checkLanguage(language), scope),
  'sets:adjust': ({ db, now }, scope, setName, language, printingId, delta) => {
    const result = adjustPrinting(
      db,
      checkString(setName, 'setName'),
      checkLanguage(language),
      checkId(printingId, 'printingId'),
      checkDelta(delta),
      now(),
      scope
    )
    settleWishlist(db, scope, now())
    recordSnapshot(db, now(), scope)
    return result
  },
  'collection:list': ({ db }, scope, f) =>
    listEntries(db, checkObject(f, 'Filters') as unknown as CollectionFilters, scope),
  'collection:forCard': ({ db }, scope, cardId) =>
    entriesForCard(db, checkId(cardId, 'cardId'), scope),
  'collection:facets': ({ db }, scope) => getFacets(db, scope),
  'collection:add': ({ db, now }, scope, input) => {
    checkNotesLength(input)
    const entry = addEntry(db, checkAddInput(input), now(), scope)
    settleWishlist(db, scope, now())
    recordSnapshot(db, now(), scope)
    return entry
  },
  'collection:update': ({ db, now }, scope, id, patch) => {
    checkNotesLength(patch)
    const entry = updateEntry(db, checkId(id, 'id'), checkUpdatePatch(patch), now(), scope)
    settleWishlist(db, scope, now())
    recordSnapshot(db, now(), scope)
    return entry
  },
  'collection:remove': ({ db, now }, scope, id) => {
    removeEntry(db, checkId(id, 'id'), now(), scope)
    recordSnapshot(db, now(), scope)
  },
  'friends:overview': ({ db, userId, game }) => friendsOverview(db, userId, game),
  'friends:request': ({ db, userId, now }, _s, username) =>
    requestFriend(db, userId, checkString(username, 'username'), now()),
  'friends:accept': ({ db, userId, now }, _s, id) =>
    acceptFriend(db, userId, checkId(id, 'userId'), now()),
  'friends:ignore': ({ db, userId }, _s, id) => ignoreFriend(db, userId, checkId(id, 'userId')),
  'friends:remove': ({ db, userId }, _s, id) => removeFriend(db, userId, checkId(id, 'userId')),
  'friends:block': ({ db, userId, now }, _s, id) =>
    blockUser(db, userId, checkId(id, 'userId'), now()),
  'friends:unblock': ({ db, userId }, _s, id) => unblockUser(db, userId, checkId(id, 'userId')),
  // A friend's binder shows the caller's game; a friend who can't use it simply has no rows there.
  'friends:collection': ({ db, userId, game }, _s, id, f) => {
    const friend = friendId(db, userId, id)
    const filters = checkObject(f, 'Filters') as unknown as CollectionFilters
    return listEntries(db, filters, userScope(friend, game)).map((e) => ({ ...e, notes: '' }))
  },
  'friends:facets': ({ db, userId, game }, _s, id) =>
    getFacets(db, userScope(friendId(db, userId, id), game)),
  'friends:stats': ({ db, userId, game }, _s, id) =>
    friendStats(db, userId, friendId(db, userId, id), game),
  'friends:sets': ({ db, userId, game }, _s, id) =>
    listSets(db, userScope(friendId(db, userId, id), game)),
  'friends:checklist': ({ db, userId, game }, _s, id, setName, language) =>
    getChecklist(
      db,
      checkString(setName, 'setName'),
      checkLanguage(language),
      userScope(friendId(db, userId, id), game)
    ),
  'friends:forCard': ({ db, userId, game }, _s, cardId) =>
    friendsWithCard(db, userId, game, checkId(cardId, 'cardId')),
  'friends:wishlist': ({ db, userId, game }, _s, id) =>
    friendWishlist(db, friendId(db, userId, id), game),
  'friends:wanting': ({ db, userId, game }, _s, cardId) =>
    friendsWanting(db, userId, game, checkId(cardId, 'cardId')),
  'friends:owning': ({ db, userId, game }, _s, pkeys) => friendsOwning(db, userId, game, pkeys),
  'friends:wishlistVisible': ({ db, userId }) => wishlistVisible(db, userId),
  'friends:setWishlistVisible': ({ db, userId }, _s, visible) =>
    setWishlistVisible(db, userId, visible),
  'wishlist:list': ({ db }, scope) => listWishlist(db, scope),
  'wishlist:forCard': ({ db }, scope, cardId) =>
    wishesForCard(db, checkId(cardId, 'cardId'), scope),
  'wishlist:set': ({ db, now }, scope, printingId, quantity) =>
    setWish(db, checkId(printingId, 'printingId'), quantity, now(), scope),
  'wishlist:remove': ({ db, now }, scope, printingId) =>
    removeWish(db, checkId(printingId, 'printingId'), now(), scope),
  'stats:get': ({ db }, scope) => getStats(db, scope)
}

/** Writes that can leave a printing owned with no fresh price. */
const QUEUES_PRICES: ReadonlySet<string> = new Set([
  'collection:add',
  'collection:update',
  'sets:adjust'
])

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const isJson = (req: Request): boolean =>
  /^application\/json\s*(;|$)/i.test(req.headers.get('content-type') ?? '')

/** POST /api/rpc/:channel with `{ args: [...] }`; answers `{ result }`. */
export async function rpcRoute(req: Request, deps: AppDeps, channel: string): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method-not-allowed' }, 405)
  // A non-simple content type forces a CORS preflight, so cross-site forms cannot reach the handlers.
  if (!isJson(req)) return json({ error: 'unsupported-media-type' }, 415)
  const user = await currentUser(req, deps)
  if (!user) return json({ error: 'signed-out' }, 401)
  if (!Object.hasOwn(HANDLERS, channel)) return json({ error: 'unknown-channel' }, 404)
  // The game comes from the caller and is checked against what they may use; unknown names fail too.
  const asked = req.headers.get(GAME_HEADER) || 'ygo'
  const game = gamesFor(deps, user.id).find((g) => g === asked)
  if (!game) return json({ error: 'game-not-allowed' }, 403)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const args = (body as { args?: unknown } | null)?.args
  if (!Array.isArray(args)) return json({ error: 'args must be an array' }, 400)

  try {
    const handler = HANDLERS[channel as PortalChannel] as (
      d: RpcDeps,
      s: Scope,
      ...a: unknown[]
    ) => unknown
    const result =
      handler({ ...deps, userId: user.id, game }, userScope(user.id, game), ...args) ?? null
    if (QUEUES_PRICES.has(channel)) await deps.prices.soon()
    return json({ result })
  } catch (e) {
    if (e instanceof CollectionError) return json({ error: e.message }, 400)
    throw e
  }
}
