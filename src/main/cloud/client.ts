import type {
  Me,
  PricesResponse,
  PullResponse,
  PushResponse,
  PushResult,
  WireEntry
} from '../../shared/cloud'

/** The portal answered 401: the desktop token is unknown, expired or revoked. */
export class CloudAuthError extends Error {
  constructor(message = 'Signed out by the server') {
    super(message)
    this.name = 'CloudAuthError'
  }
}

/** The portal couldn't be reached: fetch threw, timed out, or the server answered 5xx. */
export class CloudOfflineError extends Error {
  constructor(message = 'The portal is unreachable') {
    super(message)
    this.name = 'CloudOfflineError'
  }
}

export interface CloudClient {
  me(): Promise<Me>
  push(entries: WireEntry[]): Promise<PushResult[]>
  pull(cursor: number): Promise<PullResponse>
  prices(pkeys: string[]): Promise<PricesResponse>
  revoke(): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 30_000

/** The portal API as the desktop calls it, with its desktop token as a Bearer token. */
export function createCloudClient(opts: {
  baseUrl: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
}): CloudClient {
  const doFetch = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const base = opts.baseUrl.replace(/\/+$/, '')

  /** Sends one request; resolves to the parsed JSON body, or undefined when `parse` is false. */
  async function call<T>(path: string, method: string, body?: unknown, parse = true): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${opts.token}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const offline = (e: unknown): CloudOfflineError =>
      new CloudOfflineError(
        controller.signal.aborted
          ? 'The portal took too long to answer'
          : (e as Error | undefined)?.message || undefined
      )
    try {
      let res: Response
      try {
        res = await doFetch(base + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          // The bearer token never follows a redirect; a redirect (a captive portal, say) counts as offline.
          redirect: 'error'
        })
      } catch (e) {
        throw offline(e)
      }
      if (res.status === 401) throw new CloudAuthError()
      if (res.status >= 500) throw new CloudOfflineError(`The portal failed (${res.status})`)
      if (res.status >= 400) {
        let error: unknown
        try {
          error = ((await res.json()) as { error?: unknown } | null)?.error
        } catch {
          error = undefined
        }
        throw new Error(typeof error === 'string' ? error : `Request failed (${res.status})`)
      }
      if (!parse) return undefined as T
      try {
        return (await res.json()) as T
      } catch (e) {
        // A cut-off or non-JSON answer (a captive portal page, say) means the portal wasn't really reached.
        throw offline(e)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    me: () => call<Me>('/api/me', 'GET'),
    push: async (entries) =>
      (await call<PushResponse>('/api/sync/push', 'POST', { entries })).results,
    pull: (cursor) => call<PullResponse>(`/api/sync/pull?cursor=${cursor}`, 'GET'),
    prices: (pkeys) => call<PricesResponse>('/api/sync/prices', 'POST', { pkeys }),
    revoke: () => call<void>('/auth/desktop/revoke', 'POST', undefined, false)
  }
}
