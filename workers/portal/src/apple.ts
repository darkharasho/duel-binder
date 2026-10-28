/**
 * Sign in with Apple, from the iOS app: checks the identity token the app gets from Apple, an
 * RS256 JWT signed with one of Apple's published keys (https://appleid.apple.com/auth/keys).
 */
export const APPLE_ISSUER = 'https://appleid.apple.com'
export const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys'
/** The iOS app's bundle id, which Apple puts in the token's `aud`. */
export const APPLE_AUDIENCE = 'com.darkharasho.duelbinder'
/** Apple's keys are refetched after this long, or sooner when a token names a key not seen yet. */
const KEYS_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** The soonest an unknown key id refetches them again, so bad tokens can't hammer Apple. */
const KEYS_MIN_AGE_MS = 60 * 1000
const MAX_TOKEN_LEN = 4096

interface AppleKey {
  kid: string
  kty: string
  alg?: string
  n: string
  e: string
}

let cached: { keys: AppleKey[]; at: number } | null = null

/** Forgets the cached keys (tests). */
export function resetAppleKeys(): void {
  cached = null
}

async function appleKeys(
  doFetch: typeof fetch,
  now: number,
  refresh: boolean
): Promise<AppleKey[]> {
  const age = cached ? now - cached.at : Infinity
  if (cached && age < (refresh ? KEYS_MIN_AGE_MS : KEYS_MAX_AGE_MS)) return cached.keys
  const res = await doFetch(APPLE_KEYS_URL)
  if (!res.ok) return cached?.keys ?? []
  const { keys } = (await res.json()) as { keys?: AppleKey[] }
  cached = { keys: Array.isArray(keys) ? keys : [], at: now }
  return cached.keys
}

function fromBase64Url(part: string): Uint8Array<ArrayBuffer> {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const decodeJson = (part: string): unknown =>
  JSON.parse(new TextDecoder().decode(fromBase64Url(part)))

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The Apple user id (`sub`) of a valid identity token, or null. Valid means signed by one of
 * Apple's keys, issued by Apple for this app, not expired, and carrying the SHA-256 (hex) of
 * `nonce`, the random value the app made for this one sign-in.
 */
export async function verifyAppleIdentityToken(
  token: string,
  nonce: string,
  deps: { fetch: typeof fetch; now: () => Date }
): Promise<string | null> {
  if (token.length > MAX_TOKEN_LEN) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let header: { alg?: unknown; kid?: unknown }
  let claims: { iss?: unknown; aud?: unknown; exp?: unknown; sub?: unknown; nonce?: unknown }
  try {
    header = decodeJson(parts[0]) as typeof header
    claims = decodeJson(parts[1]) as typeof claims
  } catch {
    return null
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null

  const now = deps.now().getTime()
  let key = (await appleKeys(deps.fetch, now, false)).find((k) => k.kid === header.kid)
  if (!key) key = (await appleKeys(deps.fetch, now, true)).find((k) => k.kid === header.kid)
  if (!key || key.kty !== 'RSA') return null

  let valid: boolean
  try {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      fromBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    )
  } catch {
    return null
  }
  if (!valid) return null

  if (claims.iss !== APPLE_ISSUER || claims.aud !== APPLE_AUDIENCE) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null
  if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255)
    return null
  if (typeof claims.nonce !== 'string' || claims.nonce !== (await sha256Hex(nonce))) return null
  return claims.sub
}

export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token'
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke'

/**
 * The Sign in with Apple key (developer portal > Keys) the Worker signs its client secret with.
 * All three are Worker secrets; while any is unset, no refresh token is kept and none is revoked.
 */
export interface AppleSignInEnv {
  APPLE_TEAM_ID?: string
  APPLE_SIGNIN_KEY_ID?: string
  /** The key's .p8 file: a PKCS#8 PEM. */
  APPLE_SIGNIN_KEY?: string
}

interface AppleDeps {
  env: AppleSignInEnv
  fetch: typeof fetch
  now: () => Date
}

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const jsonPart = (v: unknown): string => toBase64Url(new TextEncoder().encode(JSON.stringify(v)))

/**
 * The client secret Apple's token and revoke endpoints want: an ES256 JWT from the team, for the
 * app, signed with the Sign in with Apple key. Null while the key isn't configured.
 */
export async function appleClientSecret(deps: AppleDeps): Promise<string | null> {
  const { APPLE_TEAM_ID: team, APPLE_SIGNIN_KEY_ID: kid, APPLE_SIGNIN_KEY: pem } = deps.env
  if (!team || !kid || !pem) return null
  const der = fromBase64Url(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  const iat = Math.floor(deps.now().getTime() / 1000)
  const input = `${jsonPart({ alg: 'ES256', kid })}.${jsonPart({
    iss: team,
    iat,
    exp: iat + 300,
    aud: APPLE_ISSUER,
    sub: APPLE_AUDIENCE
  })}`
  // WebCrypto's ECDSA signature is r || s, the form a JWT uses.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(input)
  )
  return `${input}.${toBase64Url(new Uint8Array(sig))}`
}

/**
 * Trades the one-time authorization code from the sign-in sheet for a refresh token, the only
 * thing Apple's revoke endpoint accepts for good. Null when the key isn't configured, Apple
 * refuses, or the token Apple returns belongs to another Apple account than `sub`.
 */
export async function appleRefreshToken(
  code: string,
  sub: string,
  deps: AppleDeps
): Promise<string | null> {
  const secret = await appleClientSecret(deps)
  if (!secret) return null
  const res = await deps.fetch(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLE_AUDIENCE,
      client_secret: secret,
      code,
      grant_type: 'authorization_code'
    })
  })
  if (!res.ok) return null
  const body = (await res.json()) as { refresh_token?: unknown; id_token?: unknown }
  if (typeof body.refresh_token !== 'string' || typeof body.id_token !== 'string') return null
  // Straight from Apple over TLS, so its claims need no signature check.
  const claims = decodeJson(body.id_token.split('.')[1] ?? '') as { sub?: unknown }
  return claims.sub === sub ? body.refresh_token : null
}

/** Revokes a refresh token, ending the app's Sign in with Apple link to the account. */
export async function revokeAppleToken(refreshToken: string, deps: AppleDeps): Promise<boolean> {
  const secret = await appleClientSecret(deps)
  if (!secret) return false
  const res = await deps.fetch(APPLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLE_AUDIENCE,
      client_secret: secret,
      token: refreshToken,
      token_type_hint: 'refresh_token'
    })
  })
  return res.ok
}
