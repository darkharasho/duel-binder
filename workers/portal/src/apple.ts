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
