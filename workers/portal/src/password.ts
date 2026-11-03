const ITERATIONS = 100_000 // the Workers cap
const SALT_BYTES = 16
const HASH_BITS = 256
const PREFIX = 'pbkdf2-sha256'

const b64url = (b: Uint8Array): string => {
  let s = ''
  for (const c of b) s += String.fromCharCode(c)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function derive(pw: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, [
    'deriveBits'
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    HASH_BITS
  )
  return new Uint8Array(bits)
}

/** `pbkdf2-sha256$<iterations>$<salt>$<hash>`, salt and hash base64url. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(pw, salt, ITERATIONS)
  return `${PREFIX}$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`
}

/** Reads the iteration count from the stored string; an unknown format answers false. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iter, salt, hash, extra] = stored.split('$')
    if (scheme !== PREFIX || extra !== undefined || !iter || !salt || !hash) return false
    const iterations = Number(iter)
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false
    const expected = fromB64url(hash)
    const actual = await derive(pw, fromB64url(salt), iterations)
    if (expected.length !== actual.length) return false
    let diff = 0
    for (let i = 0; i < actual.length; i++) diff |= expected[i] ^ actual[i]
    return diff === 0
  } catch {
    return false
  }
}
