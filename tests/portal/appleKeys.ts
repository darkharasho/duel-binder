import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { APPLE_AUDIENCE, APPLE_ISSUER } from '../../workers/portal/src/apple'

/** The nonce the test app made for its Sign in with Apple. */
export const APPLE_NONCE = 'nonce_0123456789abcdef'

const b64url = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url')
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

export interface AppleTestKeys {
  /** Signs identity tokens as Apple's published key `k1`. */
  appleKey: KeyObject
  /** A key Apple never published. */
  otherKey: KeyObject
  /** What Apple's keys URL answers. */
  jwks: unknown
  /** The public half of the Sign in with Apple key the Worker signs its client secret with. */
  signinKey: KeyObject
  signinPem: string
}

let keys: AppleTestKeys | null = null

/** Test keys, made once per test file (RSA key generation is slow). */
export function appleTestKeys(): AppleTestKeys {
  if (keys) return keys
  const appleKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  const pub = appleKey.export({ format: 'jwk' })
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  keys = {
    appleKey,
    otherKey,
    jwks: { keys: [{ kty: 'RSA', kid: 'k1', alg: 'RS256', use: 'sig', n: pub.n, e: pub.e }] },
    signinKey: ec.publicKey,
    signinPem: ec.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  }
  return keys
}

/** An Apple identity token for `sub` 000123.abc, issued at `now`, with any claim overridden. */
export function appleIdentityToken(
  now: Date,
  claims: Record<string, unknown> = {},
  { key = appleTestKeys().appleKey, kid = 'k1' }: { key?: KeyObject; kid?: string } = {}
): string {
  const nowSec = now.getTime() / 1000
  const head = b64url({ alg: 'RS256', kid })
  const body = b64url({
    iss: APPLE_ISSUER,
    aud: APPLE_AUDIENCE,
    sub: '000123.abc',
    iat: nowSec - 10,
    exp: nowSec + 600,
    nonce: sha256Hex(APPLE_NONCE),
    ...claims
  })
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url')
  return `${head}.${body}.${sig}`
}
