import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { memoryBucket, noPrintingArt, noPrices } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { migrateServer } from '../../workers/portal/src/migrate'
import {
  APPLE_AUDIENCE,
  APPLE_ISSUER,
  APPLE_KEYS_URL,
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

  beforeAll(() => {
    appleKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    const pub = appleKey.export({ format: 'jwk' })
    jwks = { keys: [{ kty: 'RSA', kid: 'k1', alg: 'RS256', use: 'sig', n: pub.n, e: pub.e }] }
  })

  beforeEach(() => {
    resetAppleKeys()
    keyFetches = 0
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input) === APPLE_KEYS_URL) {
        keyFetches++
        return new Response(JSON.stringify(jwks), { status: 200 })
      }
      return new Response('?', { status: 404 })
    })
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
})
