import { isLanguage, type Language } from '../../../src/shared/languages'
import type { InvokeChannel } from '../../../src/shared/ipc'
import type { Api } from '../../../src/shared/ipc'
import type { Scope } from '../../../src/main/repo/scope'
import { getCardDetail, searchCards } from '../../../src/main/repo/cards'
import { browseCards, browseFacets } from '../../../src/main/repo/browse'
import {
  CollectionError,
  entriesForCard,
  getFacets,
  listEntries
} from '../../../src/main/repo/collection'
import { getChecklist, listSets } from '../../../src/main/repo/sets'
import type { AppDeps } from './app'
import { currentUser } from './auth'
import { userScope } from './scope'

type Params<T> = T extends (...args: infer A) => unknown ? A : never

/** Channels the portal serves; Plan 2 adds the write channels to this table. */
type Served = Extract<
  InvokeChannel,
  | 'cards:search'
  | 'cards:get'
  | 'cards:browse'
  | 'cards:browseFacets'
  | 'sets:list'
  | 'sets:checklist'
  | 'collection:list'
  | 'collection:forCard'
  | 'collection:facets'
>

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

const checkLanguage = (language: unknown): Language => {
  if (!isLanguage(language)) throw new CollectionError('Unknown language')
  return language
}

const HANDLERS: { [C in Served]: Handler<C> } = {
  'cards:search': ({ db }, _s, q) => searchCards(db, q),
  'cards:get': ({ db }, _s, cardId) => getCardDetail(db, cardId),
  'cards:browse': ({ db }, scope, f) => browseCards(db, f, scope),
  'cards:browseFacets': ({ db }) => browseFacets(db),
  'sets:list': ({ db }, scope) => listSets(db, scope),
  'sets:checklist': ({ db }, scope, setName, language) =>
    getChecklist(db, setName, checkLanguage(language), scope),
  'collection:list': ({ db }, scope, f) => listEntries(db, f, scope),
  'collection:forCard': ({ db }, scope, cardId) => entriesForCard(db, cardId, scope),
  'collection:facets': ({ db }, scope) => getFacets(db, scope)
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
    const handler = HANDLERS[channel as Served] as (
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
