import type {
  CatalogChangesResponse,
  CatalogTableName,
  ContributedPrinting,
  ContributeResult
} from '../../shared/catalogFeed'
import type { UsageReport } from '../../shared/usage'
import type {
  Me,
  PriceChangesResponse,
  PriceRequestResponse,
  PricesResponse,
  PullResponse,
  PushResponse,
  PushResult,
  WireEntry
} from '../../shared/cloud'
import type { PortalChannel } from '../../shared/portal'

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
  /** One page of server price changes after `since` (the price change feed). */
  priceChanges(since: number): Promise<PriceChangesResponse>
  /** Asks the server to price these printings (at most MAX_PRICE_REQUEST); see requestPrices. */
  requestPrices(pkeys: string[]): Promise<PriceRequestResponse>
  /**
   * One page of the catalog change feed after `since`; `limit` defaults to the server's page size,
   * `tables` (default all) limits the feed to those tables.
   */
  catalogChanges(
    since: number,
    limit?: number,
    tables?: readonly CatalogTableName[]
  ): Promise<CatalogChangesResponse>
  /** Offers printings the catalog lacks; one result per printing. */
  contribute(printings: ContributedPrinting[]): Promise<ContributeResult[]>
  revoke(): Promise<void>
  /** Adds anonymous event totals to the portal's daily counters. */
  usage(report: UsageReport): Promise<void>
  /** Calls a portal RPC channel; resolves to its result. */
  rpc<T>(channel: PortalChannel, args: unknown[]): Promise<T>
}

const DEFAULT_TIMEOUT_MS = 30_000
/** Catalog pages are large, so they get longer than an ordinary call. */
const CATALOG_TIMEOUT_MS = 120_000

/** The portal API as the desktop calls it, with its desktop token as a Bearer token. */
export function createCloudClient(opts: {
  baseUrl: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Cuts off every request of this client; a request cut off fails as offline. */
  signal?: AbortSignal
}): CloudClient {
  const doFetch = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const base = opts.baseUrl.replace(/\/+$/, '')

  /** Sends one request; resolves to the parsed JSON body, or undefined when `parse` is false. */
  async function call<T>(
    path: string,
    method: string,
    body?: unknown,
    parse = true,
    callTimeoutMs = timeoutMs
  ): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${opts.token}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), callTimeoutMs)
    const cutOff = (): void => controller.abort()
    if (opts.signal?.aborted) controller.abort()
    else opts.signal?.addEventListener('abort', cutOff, { once: true })
    const offline = (e: unknown): CloudOfflineError =>
      new CloudOfflineError(
        controller.signal.aborted
          ? 'The portal took too long to answer'
          : (e as Error | undefined)?.message || undefined
      )
    try {
      let res: Response
      try {
        if (controller.signal.aborted) throw new Error('Cut off')
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
      opts.signal?.removeEventListener('abort', cutOff)
    }
  }

  return {
    me: () => call<Me>('/api/me', 'GET'),
    push: async (entries) =>
      (await call<PushResponse>('/api/sync/push', 'POST', { entries })).results,
    pull: (cursor) => call<PullResponse>(`/api/sync/pull?cursor=${cursor}`, 'GET'),
    prices: (pkeys) => call<PricesResponse>('/api/sync/prices', 'POST', { pkeys }),
    priceChanges: (since) =>
      call<PriceChangesResponse>(`/api/sync/price-changes?since=${since}`, 'GET'),
    requestPrices: (pkeys) =>
      call<PriceRequestResponse>('/api/sync/price-requests', 'POST', { pkeys }),
    catalogChanges: (since, limit, tables) =>
      call<CatalogChangesResponse>(
        `/api/catalog/changes?since=${since}${limit === undefined ? '' : `&limit=${limit}`}${
          tables ? `&tables=${tables.join(',')}` : ''
        }`,
        'GET',
        undefined,
        true,
        Math.max(timeoutMs, CATALOG_TIMEOUT_MS)
      ),
    contribute: async (printings) =>
      (
        await call<{ results: ContributeResult[] }>('/api/catalog/contribute', 'POST', {
          printings
        })
      ).results,
    revoke: () => call<void>('/auth/desktop/revoke', 'POST', undefined, false),
    usage: (report) => call<void>('/api/usage', 'POST', report, false),
    rpc: async <T>(channel: PortalChannel, args: unknown[]) =>
      (await call<{ result: T }>(`/api/rpc/${channel}`, 'POST', { args })).result
  }
}
