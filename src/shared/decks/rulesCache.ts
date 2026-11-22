import type { GameId } from '../games'
import { parseRulesPack, type PackState } from './pack'

export interface CachedPack {
  body: string
  etag: string | null
  /** ISO time the portal was last asked (or answered 304). */
  checkedAt: string
}

export interface PackStore {
  read(game: GameId): Promise<CachedPack | null>
  write(game: GameId, c: CachedPack): Promise<void>
}

/** A pack checked more recently than this isn't asked for again. */
export const PACK_REFRESH_MS = 24 * 3600 * 1000

function parseBody(body: string): PackState {
  try {
    return parseRulesPack(JSON.parse(body))
  } catch {
    return { state: 'missing' }
  }
}

/**
 * The rules pack of a game: the cached copy when it was checked in the last 24 h, else asked of
 * the portal with its ETag. A failure of any kind keeps the cache; it never throws.
 */
export async function loadRulesPack(
  game: GameId,
  deps: { store: PackStore; fetch: typeof fetch; origin: string; now: () => Date }
): Promise<PackState> {
  const { store, now } = deps
  let cached: CachedPack | null = null
  try {
    cached = await store.read(game)
  } catch {
    cached = null
  }
  const fallback = (): PackState => (cached ? parseBody(cached.body) : { state: 'missing' })
  const checked = cached ? Date.parse(cached.checkedAt) : NaN
  if (cached && now().getTime() - checked < PACK_REFRESH_MS) return fallback()
  try {
    const headers: Record<string, string> = {}
    if (cached?.etag) headers['If-None-Match'] = cached.etag
    const res = await deps.fetch(`${deps.origin.replace(/\/+$/, '')}/api/rules/${game}`, {
      headers,
      signal: AbortSignal.timeout(15_000)
    })
    if (res.status === 304 && cached) {
      await store.write(game, { ...cached, checkedAt: now().toISOString() })
      return fallback()
    }
    if (!res.ok) {
      await res.body?.cancel()
      return fallback()
    }
    const body = await res.text()
    const state = parseBody(body)
    if (state.state === 'missing') return fallback()
    await store.write(game, { body, etag: res.headers.get('etag'), checkedAt: now().toISOString() })
    return state
  } catch {
    return fallback()
  }
}
