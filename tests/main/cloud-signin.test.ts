import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Me } from '../../src/shared/cloud'
import { portalUrl } from '../../src/main/cloud/config'
import { SignInError, signInWithBrowser } from '../../src/main/cloud/signIn'
import { TokenStore, type Cipher } from '../../src/main/cloud/tokenStore'

const PORTAL = 'https://portal.test'
const ME: Me = { id: 7, username: 'yugi', displayName: 'Yugi', avatarUrl: null }

/** Reverses and prefixes the string, so the file never holds the plain value. */
const fakeCipher: Cipher = {
  encrypt: (plain) => Buffer.from('enc:' + [...plain].reverse().join(''), 'utf8'),
  decrypt: (buf) => {
    const s = buf.toString('utf8')
    if (!s.startsWith('enc:')) throw new Error('bad blob')
    return [...s.slice(4)].reverse().join('')
  }
}
const brokenCipher: Cipher = {
  encrypt: fakeCipher.encrypt,
  decrypt: () => {
    throw new Error('cannot decrypt')
  }
}

describe('TokenStore', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'duel-binder-token-'))
    file = join(dir, 'nested', 'account.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('token round-trips and the file holds no plain text and is 0600', () => {
    const store = new TokenStore(file, fakeCipher)
    expect(store.get()).toBeNull()
    store.set('secret-token-123')
    expect(store.get()).toBe('secret-token-123')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('secret-token-123')
    expect(raw).not.toContain('321-nekot-terces')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    store.clear()
    expect(store.get()).toBeNull()
    expect(new TokenStore(file, fakeCipher).get()).toBeNull()
  })

  it('a corrupt file reads as signed out', () => {
    const store = new TokenStore(file, fakeCipher)
    store.set('tok')
    writeFileSync(file, '{not json')
    expect(store.get()).toBeNull()
    expect(store.pendingRevokes()).toEqual([])
    writeFileSync(file, 'null')
    expect(store.get()).toBeNull()
    store.set('again')
    expect(store.get()).toBe('again')
  })

  it("a value that won't decrypt reads as signed out", () => {
    new TokenStore(file, fakeCipher).set('tok')
    new TokenStore(file, fakeCipher).addPendingRevoke('old')
    const broken = new TokenStore(file, brokenCipher)
    expect(broken.get()).toBeNull()
    expect(broken.pendingRevokes()).toEqual([])
  })

  it('pending revokes are kept until removed', () => {
    const store = new TokenStore(file, fakeCipher)
    store.set('current')
    store.addPendingRevoke('old-1')
    store.addPendingRevoke('old-2')
    store.addPendingRevoke('old-1')
    store.clear()
    const reopened = new TokenStore(file, fakeCipher)
    expect(reopened.pendingRevokes()).toEqual(['old-1', 'old-2'])
    expect(readFileSync(file, 'utf8')).not.toContain('old-1')
    reopened.removePendingRevoke('old-1')
    expect(reopened.pendingRevokes()).toEqual(['old-2'])
    reopened.removePendingRevoke('old-2')
    expect(reopened.pendingRevokes()).toEqual([])
    expect(existsSync(file)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'writes replace a loose-permission file atomically and leave no temp files',
    () => {
      const store = new TokenStore(file, fakeCipher)
      store.set('first')
      chmodSync(file, 0o644)
      store.set('second')
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(store.get()).toBe('second')
      expect(readdirSync(join(dir, 'nested'))).toEqual(['account.json'])
    }
  )
})

/** Runs sign-in, handing the test the start URL once the browser would open. */
function startSignIn(
  opts: { exchange?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {}
): { result: Promise<{ token: string; user: Me }>; started: Promise<URL> } {
  let opened!: (url: URL) => void
  const started = new Promise<URL>((r) => (opened = r))
  const result = signInWithBrowser({
    portalUrl: PORTAL,
    openExternal: async (url) => opened(new URL(url)),
    fetch: opts.exchange ?? (vi.fn() as unknown as typeof fetch),
    timeoutMs: opts.timeoutMs,
    signal: opts.signal
  })
  return { result, started }
}

function callback(start: URL, query: Record<string, string>): Promise<Response> {
  const port = start.searchParams.get('port')
  return fetch(`http://127.0.0.1:${port}/callback?${new URLSearchParams(query)}`)
}

/** Resolves true when nothing listens on the port any more. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(true))
  })
}

const base64url = (b: Buffer): string => b.toString('base64url')

describe('signInWithBrowser', () => {
  it('sign-in returns the token and user from the code exchange', async () => {
    const exchange = vi.fn<typeof fetch>(async () =>
      Response.json({ token: 'desk-token', user: ME })
    )
    const { result, started } = startSignIn({ exchange })
    const start = await started
    expect(start.origin + start.pathname).toBe(`${PORTAL}/auth/desktop/start`)
    const port = Number(start.searchParams.get('port'))
    expect(port).toBeGreaterThanOrEqual(1024)
    const state = start.searchParams.get('state')!
    expect(state).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    const challenge = start.searchParams.get('challenge')!
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const other = await fetch(`http://127.0.0.1:${port}/elsewhere`)
    expect(other.status).toBe(404)

    const page = await callback(start, { code: 'the-code', state })
    expect(page.status).toBe(200)
    const text = await page.text()
    expect(text).toContain("You're signed in.")
    expect(text).not.toContain('the-code')

    await expect(result).resolves.toEqual({ token: 'desk-token', user: ME })
    expect(exchange).toHaveBeenCalledTimes(1)
    const [url, init] = exchange.mock.calls[0]
    expect(String(url)).toBe(`${PORTAL}/auth/desktop/token`)
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    const body = JSON.parse(String(init?.body)) as { code: string; verifier: string }
    expect(body.code).toBe('the-code')
    expect(body.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    expect(base64url(createHash('sha256').update(body.verifier).digest())).toBe(challenge)
    expect(await portIsFree(port)).toBe(true)
  })

  it('a wrong state is ignored without exchanging the code', async () => {
    const exchange = vi.fn<typeof fetch>(async () =>
      Response.json({ token: 'desk-token', user: ME })
    )
    const { result, started } = startSignIn({ exchange })
    let settled = false
    void result.then(
      () => (settled = true),
      () => (settled = true)
    )
    const start = await started
    const state = start.searchParams.get('state')!
    for (const query of <Record<string, string>[]>[
      { code: 'c', state: 'x'.repeat(43) },
      { error: 'signin-failed', state: 'x'.repeat(43) },
      { code: 'c' },
      { state }
    ]) {
      const page = await callback(start, query)
      expect(await page.text()).toContain("Sign-in didn't go through.")
    }
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)
    expect(exchange).not.toHaveBeenCalled()

    const page = await callback(start, { code: 'good', state })
    expect(await page.text()).toContain("You're signed in.")
    await expect(result).resolves.toEqual({ token: 'desk-token', user: ME })
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  it('an error from the portal rejects', async () => {
    const exchange = vi.fn()
    const { result, started } = startSignIn({ exchange: exchange as unknown as typeof fetch })
    const rejected = expect(result).rejects.toThrow(new SignInError("Sign-in didn't go through"))
    const start = await started
    const state = start.searchParams.get('state')!
    const page = await callback(start, { error: 'signin-failed', state })
    expect(await page.text()).toContain("Sign-in didn't go through.")
    await rejected
    expect(exchange).not.toHaveBeenCalled()
    expect(await portIsFree(Number(start.searchParams.get('port')))).toBe(true)
  })

  it('a failed code exchange rejects without echoing the response', async () => {
    const exchange = vi.fn(async () => Response.json({ error: 'invalid-code' }, { status: 400 }))
    const { result, started } = startSignIn({ exchange: exchange as unknown as typeof fetch })
    const rejected = expect(result).rejects.toThrow(new SignInError("Sign-in didn't go through"))
    const start = await started
    const page = await callback(start, { code: 'c', state: start.searchParams.get('state')! })
    expect(await page.text()).toContain("Sign-in didn't go through.")
    await rejected
  })

  it('sign-in times out and frees the port', async () => {
    const { result, started } = startSignIn({ timeoutMs: 50 })
    const rejected = expect(result).rejects.toThrow(new SignInError('Sign-in timed out'))
    const start = await started
    await rejected
    expect(await portIsFree(Number(start.searchParams.get('port')))).toBe(true)
  })

  it('a timeout during the code exchange aborts it and frees the port', async () => {
    let exchangeSignal: AbortSignal | undefined
    const exchange = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          exchangeSignal = init?.signal ?? undefined
          exchangeSignal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const { result, started } = startSignIn({ exchange, timeoutMs: 200 })
    const rejected = expect(result).rejects.toThrow(new SignInError('Sign-in timed out'))
    const start = await started
    const page = callback(start, { code: 'c', state: start.searchParams.get('state')! }).catch(
      () => null
    )
    await rejected
    expect(exchange).toHaveBeenCalledTimes(1)
    expect(exchangeSignal?.aborted).toBe(true)
    await page
    expect(await portIsFree(Number(start.searchParams.get('port')))).toBe(true)
  })

  it('aborting before start never opens the browser', async () => {
    const controller = new AbortController()
    controller.abort()
    const openExternal = vi.fn(async () => {})
    await expect(
      signInWithBrowser({ portalUrl: PORTAL, openExternal, signal: controller.signal })
    ).rejects.toThrow(new SignInError('Sign-in was cancelled'))
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('a synchronous throw from openExternal rejects and frees the port', async () => {
    let port = 0
    await expect(
      signInWithBrowser({
        portalUrl: PORTAL,
        openExternal: (url) => {
          port = Number(new URL(url).searchParams.get('port'))
          throw new Error('no browser')
        }
      })
    ).rejects.toThrow(new SignInError("Sign-in didn't go through"))
    expect(await portIsFree(port)).toBe(true)
  })

  it('aborting cancels sign-in', async () => {
    const controller = new AbortController()
    const { result, started } = startSignIn({ signal: controller.signal })
    const rejected = expect(result).rejects.toThrow(new SignInError('Sign-in was cancelled'))
    const start = await started
    controller.abort()
    await rejected
    expect(await portIsFree(Number(start.searchParams.get('port')))).toBe(true)
  })
})

describe('portalUrl', () => {
  it('portalUrl ignores the override in packaged builds', () => {
    const env = { DUEL_BINDER_PORTAL_URL: 'http://localhost:8787' }
    expect(portalUrl(env, true)).toBe('https://app.duelbinder.com')
    expect(portalUrl(env, false)).toBe('http://localhost:8787')
    expect(portalUrl({}, false)).toBe('https://app.duelbinder.com')
  })
})
