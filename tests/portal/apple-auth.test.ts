import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { memoryBucket, noPrintingArt, noPrices } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { migrateServer } from '../../workers/portal/src/migrate'
import {
  APPLE_AUDIENCE,
  APPLE_ISSUER,
  APPLE_KEYS_URL,
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
  resetAppleKeys
} from '../../workers/portal/src/apple'

const BASE = 'https://portal.test'
const NONCE = 'nonce_0123456789abcdef'
const NOW = new Date('2026-10-27T12:00:00.000Z')
const nowSec = NOW.getTime() / 1000
const b64url = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url')
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

let appleKey: KeyObject
let otherKey: KeyObject
let jwks: unknown
/** The Sign in with Apple key the Worker signs its client secret with. */
let signinKey: KeyObject
let signinPem: string

function identityToken(
  claims: Record<string, unknown> = {},
  { key = appleKey, kid = 'k1' }: { key?: KeyObject; kid?: string } = {}
): string {
  const head = b64url({ alg: 'RS256', kid })
  const body = b64url({
    iss: APPLE_ISSUER,
    aud: APPLE_AUDIENCE,
    sub: '000123.abc',
    iat: nowSec - 10,
    exp: nowSec + 600,
    nonce: sha256Hex(NONCE),
    ...claims
  })
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url')
  return `${head}.${body}.${sig}`
}

describe('Sign in with Apple', () => {
  let db: Database.Database
  let deps: AppDeps
  let keyFetches: number
  /** Form bodies posted to Apple's token and revoke endpoints. */
  let tokenCalls: URLSearchParams[]
  let revokeCalls: URLSearchParams[]
  /** What Apple's token endpoint answers. */
  let tokenReply: () => Response

  beforeAll(() => {
    appleKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    const pub = appleKey.export({ format: 'jwk' })
    jwks = { keys: [{ kty: 'RSA', kid: 'k1', alg: 'RS256', use: 'sig', n: pub.n, e: pub.e }] }
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    signinKey = ec.publicKey
    signinPem = ec.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  })

  beforeEach(() => {
    resetAppleKeys()
    keyFetches = 0
    tokenCalls = []
    revokeCalls = []
    tokenReply = () =>
      new Response(
        JSON.stringify({
          refresh_token: 'rt-1',
          access_token: 'at-1',
          id_token: `${b64url({ alg: 'RS256' })}.${b64url({ sub: '000123.abc' })}.sig`
        }),
        { status: 200 }
      )
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (String(input) === APPLE_KEYS_URL) {
          keyFetches++
          return new Response(JSON.stringify(jwks), { status: 200 })
        }
        if (String(input) === APPLE_TOKEN_URL) {
          tokenCalls.push(new URLSearchParams(init?.body as URLSearchParams))
          return tokenReply()
        }
        if (String(input) === APPLE_REVOKE_URL) {
          revokeCalls.push(new URLSearchParams(init?.body as URLSearchParams))
          return new Response(null, { status: 200 })
        }
        return new Response('?', { status: 404 })
      }
    )
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'cid',
        DISCORD_CLIENT_SECRET: 'secret',
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => NOW,
      fetch: fetchMock as unknown as typeof fetch
    }
  })

  const signIn = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    handle(
      new Request(`${BASE}/auth/apple/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
      }),
      deps
    )

  it('makes an account on first sign-in and returns a working Bearer token', async () => {
    const res = await signIn({
      identityToken: identityToken(),
      nonce: NONCE,
      givenName: ' Seto ',
      familyName: 'Kaiba'
    })
    expect(res.status).toBe(200)
    const { token, user } = (await res.json()) as {
      token: string
      user: { username: string; displayName: string | null; avatarUrl: string | null }
    }
    expect(user.username).toMatch(/^duelist-[a-z2-9]{8}$/)
    expect(user.displayName).toBe('Seto Kaiba')
    expect(user.avatarUrl).toBeNull()
    expect(db.prepare('SELECT discord_id FROM users').get()).toEqual({
      discord_id: 'apple:000123.abc'
    })

    const me = await handle(
      new Request(`${BASE}/api/me`, { headers: { authorization: `Bearer ${token}` } }),
      deps
    )
    expect(me.status).toBe(200)
    expect(((await me.json()) as { username: string }).username).toBe(user.username)
  })

  it('signs the same Apple account back in, keeping its name when Apple sends none', async () => {
    await signIn({ identityToken: identityToken(), nonce: NONCE, givenName: 'Seto' })
    const again = await signIn({ identityToken: identityToken(), nonce: NONCE })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { user: { displayName: string } }).user.displayName).toBe(
      'Seto'
    )
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 })
    expect(db.prepare("SELECT count(*) AS n FROM sessions WHERE kind = 'desktop'").get()).toEqual({
      n: 2
    })
    // Apple's keys were fetched once and reused.
    expect(keyFetches).toBe(1)
  })

  it("refetches Apple's keys for an unknown key id at most once a minute", async () => {
    await signIn({ identityToken: identityToken(), nonce: NONCE })
    await signIn({ identityToken: identityToken({}, { kid: 'new' }), nonce: NONCE })
    await signIn({ identityToken: identityToken({}, { kid: 'new' }), nonce: NONCE })
    expect(keyFetches).toBe(1)
  })

  it.each([
    ['another signing key', () => identityToken({}, { key: otherKey })],
    ['an unknown key id', () => identityToken({}, { kid: 'nope' })],
    ['another app', () => identityToken({ aud: 'com.example.other' })],
    ['another issuer', () => identityToken({ iss: 'https://evil.test' })],
    ['an expired token', () => identityToken({ exp: nowSec - 1 })],
    ['another nonce', () => identityToken({ nonce: sha256Hex('different-nonce-value') })],
    ['no nonce', () => identityToken({ nonce: undefined })],
    ['garbage', () => 'not.a.jwt']
  ])('refuses %s', async (_label, make) => {
    const res = await signIn({ identityToken: make(), nonce: NONCE })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid-token' })
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 })
  })

  it('refuses a missing or malformed nonce and a non-JSON body', async () => {
    expect((await signIn({ identityToken: identityToken() })).status).toBe(400)
    expect((await signIn({ identityToken: identityToken(), nonce: 'short' })).status).toBe(400)
    const form = await handle(
      new Request(`${BASE}/auth/apple/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'identityToken=x'
      }),
      deps
    )
    expect(form.status).toBe(415)
  })

  it('answers the iOS app with CORS', async () => {
    const res = await signIn(
      { identityToken: identityToken(), nonce: NONCE },
      { origin: 'capacitor://localhost' }
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })

  describe('revoking on account delete', () => {
    const withAppleKey = (): void => {
      deps.env = {
        ...deps.env,
        APPLE_TEAM_ID: 'TEAM123456',
        APPLE_SIGNIN_KEY_ID: 'KEY1234567',
        APPLE_SIGNIN_KEY: signinPem
      }
    }
    const signInWithCode = async (): Promise<string> => {
      const res = await signIn({
        identityToken: identityToken(),
        nonce: NONCE,
        authorizationCode: 'c0de'
      })
      expect(res.status).toBe(200)
      return ((await res.json()) as { token: string }).token
    }
    const deleteAccount = (token: string): Promise<Response> =>
      handle(
        new Request(`${BASE}/api/account/delete`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: 'delete' })
        }),
        deps
      )
    const storedToken = (): unknown =>
      (db.prepare('SELECT refresh_token FROM apple_tokens').get() as { refresh_token: string })
        ?.refresh_token

    it('keeps the refresh token from the sign-in and revokes it when the account is deleted', async () => {
      withAppleKey()
      const token = await signInWithCode()
      expect(storedToken()).toBe('rt-1')

      const [trade] = tokenCalls
      expect(trade.get('code')).toBe('c0de')
      expect(trade.get('grant_type')).toBe('authorization_code')
      expect(trade.get('client_id')).toBe(APPLE_AUDIENCE)
      // The client secret is an ES256 JWT signed with the Sign in with Apple key.
      const [head, body, sig] = trade.get('client_secret')!.split('.')
      expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({
        alg: 'ES256',
        kid: 'KEY1234567'
      })
      expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({
        iss: 'TEAM123456',
        iat: nowSec,
        exp: nowSec + 300,
        aud: APPLE_ISSUER,
        sub: APPLE_AUDIENCE
      })
      expect(
        verify(
          'sha256',
          Buffer.from(`${head}.${body}`),
          { key: signinKey, dsaEncoding: 'ieee-p1363' },
          Buffer.from(sig, 'base64url')
        )
      ).toBe(true)

      expect((await deleteAccount(token)).status).toBe(204)
      expect(revokeCalls).toHaveLength(1)
      expect(revokeCalls[0].get('token')).toBe('rt-1')
      expect(revokeCalls[0].get('token_type_hint')).toBe('refresh_token')
      expect(db.prepare('SELECT count(*) AS n FROM apple_tokens').get()).toEqual({ n: 0 })
    })

    it('replaces the kept token on a later sign-in', async () => {
      withAppleKey()
      await signInWithCode()
      tokenReply = () =>
        new Response(
          JSON.stringify({
            refresh_token: 'rt-2',
            id_token: `${b64url({})}.${b64url({ sub: '000123.abc' })}.sig`
          }),
          { status: 200 }
        )
      await signInWithCode()
      expect(storedToken()).toBe('rt-2')
    })

    it('signs in without keeping a token when the key is unset or Apple refuses', async () => {
      await signInWithCode()
      expect(tokenCalls).toHaveLength(0)
      expect(storedToken()).toBeUndefined()

      withAppleKey()
      tokenReply = () => new Response('{"error":"invalid_grant"}', { status: 400 })
      await signInWithCode()
      expect(storedToken()).toBeUndefined()
    })

    it("doesn't keep a token Apple issued for another Apple account", async () => {
      withAppleKey()
      tokenReply = () =>
        new Response(
          JSON.stringify({
            refresh_token: 'rt-other',
            id_token: `${b64url({})}.${b64url({ sub: 'someone.else' })}.sig`
          }),
          { status: 200 }
        )
      await signInWithCode()
      expect(storedToken()).toBeUndefined()
    })

    it('deletes the account even when the revoke fails', async () => {
      withAppleKey()
      const token = await signInWithCode()
      const fetchMock = deps.fetch
      deps.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === APPLE_REVOKE_URL
          ? new Response(null, { status: 500 })
          : fetchMock(input, init)) as typeof fetch
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect((await deleteAccount(token)).status).toBe(204)
      expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 })
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })
  })
})
