import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Me } from '../../shared/cloud'

const TIMED_OUT = 'Sign-in timed out'
const CANCELLED = 'Sign-in was cancelled'
const FAILED = "Sign-in didn't go through"

/** Why browser sign-in ended without a token. The message never carries the token or the portal's reply. */
export class SignInError extends Error {
  constructor(message: typeof TIMED_OUT | typeof CANCELLED | typeof FAILED) {
    super(message)
    this.name = 'SignInError'
  }
}

const SIGNED_IN_PAGE = "You're signed in. You can close this tab and return to Duel Binder."
const FAILED_PAGE = "Sign-in didn't go through. Return to Duel Binder and try again."

const DEFAULT_TIMEOUT_MS = 300_000
const LISTEN_ATTEMPTS = 5

/**
 * Signs in through the system browser: a loopback server on 127.0.0.1 receives the portal's
 * one-time code, which is exchanged with the PKCE verifier for a desktop token.
 */
export async function signInWithBrowser(deps: {
  portalUrl: string
  openExternal(url: string): Promise<void>
  fetch?: typeof fetch
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<{ token: string; user: Me }> {
  const doFetch = deps.fetch ?? fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const base = deps.portalUrl.replace(/\/+$/, '')
  if (deps.signal?.aborted) throw new SignInError(CANCELLED)

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(32).toString('base64url')

  const { server, port } = await listenOnLoopback()

  return new Promise((resolve, reject) => {
    let settled = false
    let answered = false
    const exchangeAbort = new AbortController()

    const finish = (
      outcome: { error: SignInError } | { value: { token: string; user: Me } }
    ): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      deps.signal?.removeEventListener('abort', onAbort)
      exchangeAbort.abort()
      // Stops listening at once; the answered browser connection closes itself (Connection: close).
      server.close()
      if ('error' in outcome) {
        server.closeAllConnections()
        reject(outcome.error)
      } else {
        server.closeIdleConnections()
        resolve(outcome.value)
      }
    }

    const timer = setTimeout(() => finish({ error: new SignInError(TIMED_OUT) }), timeoutMs)
    const onAbort = (): void => finish({ error: new SignInError(CANCELLED) })
    deps.signal?.addEventListener('abort', onAbort, { once: true })
    // Aborted while the server was starting: the listener above won't fire.
    if (deps.signal?.aborted) {
      onAbort()
      return
    }

    async function exchange(params: URLSearchParams): Promise<{ token: string; user: Me }> {
      if (!sameSecret(params.get('state') ?? '', state) || params.has('error')) {
        throw new SignInError(FAILED)
      }
      const code = params.get('code')
      if (!code) throw new SignInError(FAILED)
      let res: Response
      try {
        res = await doFetch(`${base}/auth/desktop/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, verifier }),
          signal: exchangeAbort.signal,
          // The code and verifier never follow a redirect.
          redirect: 'error'
        })
      } catch {
        throw new SignInError(FAILED)
      }
      if (res.status !== 200) throw new SignInError(FAILED)
      let body: unknown
      try {
        body = await res.json()
      } catch {
        throw new SignInError(FAILED)
      }
      const { token, user } = (body ?? {}) as { token?: unknown; user?: unknown }
      if (typeof token !== 'string' || token === '' || !isMe(user)) throw new SignInError(FAILED)
      return { token, user }
    }

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method !== 'GET' || url.pathname !== '/callback') {
        reply(res, 404, 'Not found')
        return
      }
      // Only the first callback decides the outcome.
      if (answered || settled) {
        reply(res, 400, FAILED_PAGE)
        return
      }
      answered = true
      exchange(url.searchParams).then(
        (value) => {
          reply(res, 200, SIGNED_IN_PAGE)
          finish({ value })
        },
        (e: unknown) => {
          reply(res, 400, FAILED_PAGE)
          finish({ error: e instanceof SignInError ? e : new SignInError(FAILED) })
        }
      )
    })

    const startUrl =
      `${base}/auth/desktop/start?` + new URLSearchParams({ port: String(port), state, challenge })
    deps.openExternal(startUrl).catch(() => finish({ error: new SignInError(FAILED) }))
  })
}

/** Listens on an ephemeral 127.0.0.1 port, retrying in the unlikely case it lands below 1024. */
async function listenOnLoopback(): Promise<{ server: Server; port: number }> {
  for (let attempt = 0; attempt < LISTEN_ATTEMPTS; attempt++) {
    const server = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
    } catch {
      throw new SignInError(FAILED)
    }
    const { port } = server.address() as AddressInfo
    if (port >= 1024) return { server, port }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  throw new SignInError(FAILED)
}

/** A fixed plain-text page; nothing from the request is echoed back. */
function reply(res: ServerResponse, status: number, text: string): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    connection: 'close'
  })
  res.end(text)
}

function sameSecret(got: string, expected: string): boolean {
  const a = Buffer.from(got, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function isMe(v: unknown): v is Me {
  if (!v || typeof v !== 'object') return false
  const u = v as Record<string, unknown>
  return (
    typeof u.id === 'number' &&
    typeof u.username === 'string' &&
    (u.displayName === null || typeof u.displayName === 'string') &&
    (u.avatarUrl === null || typeof u.avatarUrl === 'string')
  )
}
