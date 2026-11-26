/**
 * A donated trace's upload token: `<trace id>.<user id>.<expiry ms>.<signature>`, signed with a key
 * made from ADMIN_TOKEN. The Durable Object hands one out when a trace starts; the Worker checks it
 * on each file, so a trace's frames go straight to R2 without passing through the one Durable
 * Object (which a long upload would hold up for everyone).
 */

const encoder = new TextEncoder()

async function keyOf(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`trace-upload:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

const hex = (b: ArrayBuffer): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

const unhex = (s: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^(?:[0-9a-f]{2})+$/.test(s)) return null
  return new Uint8Array(s.match(/../g)!.map((x) => parseInt(x, 16)))
}

export async function signTraceToken(
  secret: string,
  traceId: number,
  userId: number,
  expiresAt: number
): Promise<string> {
  const body = `${traceId}.${userId}.${expiresAt}`
  const sig = await crypto.subtle.sign('HMAC', await keyOf(secret), encoder.encode(body))
  return `${body}.${hex(sig)}`
}

/** The trace a token lets files into, or null when it is forged, malformed or expired. */
export async function readTraceToken(
  secret: string,
  token: string,
  now: number
): Promise<{ traceId: number; userId: number } | null> {
  const m = /^(\d{1,15})\.(\d{1,15})\.(\d{1,15})\.([0-9a-f]{64})$/.exec(token)
  if (!m) return null
  const [, id, user, exp, sig] = m
  if (Number(exp) <= now) return null
  const bytes = unhex(sig!)
  if (!bytes) return null
  const ok = await crypto.subtle.verify(
    'HMAC',
    await keyOf(secret),
    bytes,
    encoder.encode(`${id}.${user}.${exp}`)
  )
  return ok ? { traceId: Number(id), userId: Number(user) } : null
}
