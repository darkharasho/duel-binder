import type { Api, InvokeChannel } from '../../../src/shared/ipc'
import type { PortalChannel } from '../../../src/shared/portal'
import type { BrowseFilters, CollectionFilters } from '../../../src/shared/types'
import type { Scope } from '../../../src/main/repo/scope'
import {
  checkAddInput,
  checkDelta,
  checkId,
  checkLanguage,
  checkObject,
  checkString,
  checkUpdatePatch
} from '../../../src/main/repo/args'
import { getCardDetail, searchCards } from '../../../src/main/repo/cards'
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
import type { AppDeps } from './app'
import { currentUser } from './auth'
import { userScope } from './scope'

type Params<T> = T extends (...args: infer A) => unknown ? A : never

type ChannelMethod<C extends InvokeChannel> = C extends `${infer N}:${infer M}`
  ? N extends keyof Api
    ? M extends keyof Api[N]
      ? Api[N][M]
      : never
    : never
  : never

type Handler<C extends InvokeChannel> = (
  deps: AppDeps,
  scope: Scope,
  ...args: Params<ChannelMethod<C>>
) => unknown

// Arguments come off the wire untyped: every handler checks its own before use.
const HANDLERS: { [C in PortalChannel]: Handler<C> } = {
  'cards:search': ({ db }, _s, q) => searchCards(db, checkString(q, 'q')),
  'cards:get': ({ db }, _s, cardId) => getCardDetail(db, checkId(cardId, 'cardId')),
  'cards:browse': ({ db }, scope, f) =>
    browseCards(db, checkObject(f, 'Filters') as unknown as BrowseFilters, scope),
  'cards:browseFacets': ({ db }) => browseFacets(db),
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
    recordSnapshot(db, now(), scope)
    return result
  },
  'collection:list': ({ db }, scope, f) =>
    listEntries(db, checkObject(f, 'Filters') as unknown as CollectionFilters, scope),
  'collection:forCard': ({ db }, scope, cardId) => entriesForCard(db, checkId(cardId, 'cardId'), scope),
  'collection:facets': ({ db }, scope) => getFacets(db, scope),
  'collection:add': ({ db, now }, scope, input) => {
    const entry = addEntry(db, checkAddInput(input), now(), scope)
    recordSnapshot(db, now(), scope)
    return entry
  },
  'collection:update': ({ db, now }, scope, id, patch) => {
    const entry = updateEntry(db, checkId(id, 'id'), checkUpdatePatch(patch), now(), scope)
    recordSnapshot(db, now(), scope)
    return entry
  },
  'collection:remove': ({ db, now }, scope, id) => {
    removeEntry(db, checkId(id, 'id'), now(), scope)
    recordSnapshot(db, now(), scope)
  },
  'stats:get': ({ db }, scope) => getStats(db, scope)
}

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
      d: AppDeps,
      s: Scope,
      ...a: unknown[]
    ) => unknown
    return json({ result: handler(deps, userScope(user.id), ...args) ?? null })
  } catch (e) {
    if (e instanceof CollectionError) return json({ error: e.message }, 400)
    throw e
  }
}
