import { registerPlugin } from '@capacitor/core'
import type { Me } from '../shared/cloud'
import { PORTAL_ORIGIN } from '@/lib/portal'

/**
 * The iOS app's sign-in plugin (ios/App/App/WebAuthPlugin.swift): `start` is an
 * ASWebAuthenticationSession that opens `url` and resolves with the URL it ended at on
 * `callbackScheme`; `appleSignIn` is Sign in with Apple, with `nonce` the SHA-256 (hex) of the
 * app's random value. Both reject with the code CANCELLED when the sheet is closed.
 */
interface WebAuthPlugin {
  start(options: { url: string; callbackScheme: string }): Promise<{ url: string }>
  appleSignIn(options: {
    nonce: string
  }): Promise<{ identityToken: string; givenName?: string; familyName?: string }>
}
const WebAuth = registerPlugin<WebAuthPlugin>('WebAuth')

const CALLBACK_SCHEME = 'duelbinder'

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const random = (n: number): string => base64Url(crypto.getRandomValues(new Uint8Array(n)))

/** Thrown when the person closes the sign-in sheet; the screen just offers the button again. */
export class SignInCancelled extends Error {}

/** Runs a plugin call, turning a closed sheet into SignInCancelled. */
async function sheet<T>(open: () => Promise<T>): Promise<T> {
  try {
    return await open()
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'CANCELLED') throw new SignInCancelled()
    throw e
  }
}

/** POSTs `body` to a portal sign-in route and reads its `{ token, user }`. */
async function tradeForToken(
  doFetch: typeof fetch,
  path: string,
  body: unknown
): Promise<{ token: string; user: Me }> {
  const res = await doFetch(`${PORTAL_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error('signin-failed')
  const out = (await res.json()) as { token?: unknown; user?: Me }
  if (typeof out.token !== 'string' || !out.user) throw new Error('signin-failed')
  return { token: out.token, user: out.user }
}

/**
 * Discord sign-in for the iOS app: the portal's desktop flow (`?app=ios`) with a PKCE challenge,
 * shown in the system's sign-in sheet, which hands back a one-time code on duelbinder://; the code
 * and verifier trade for the app's Bearer token like the desktop's. Rejects with SignInCancelled
 * when the sheet is closed, and with an Error when the sign-in fails.
 */
export async function nativeSignIn(
  deps: { start?: WebAuthPlugin['start']; fetch?: typeof fetch } = {}
): Promise<{ token: string; user: Me }> {
  const start = deps.start ?? ((o) => WebAuth.start(o))
  const doFetch = deps.fetch ?? fetch
  const state = random(24)
  const verifier = random(48)
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  )
  const startUrl = `${PORTAL_ORIGIN}/auth/desktop/start?${new URLSearchParams({ app: 'ios', state, challenge })}`

  const { url: ended } = await sheet(() =>
    start({ url: startUrl, callbackScheme: CALLBACK_SCHEME })
  )
  const q = new URL(ended).searchParams
  const code = q.get('code')
  if (q.get('state') !== state || q.has('error') || !code) throw new Error('signin-failed')
  return tradeForToken(doFetch, '/auth/desktop/token', { code, verifier })
}

/**
 * Sign in with Apple for the iOS app: the system's Apple sheet signs a token for a random nonce
 * (Apple gets its SHA-256), which the portal checks and trades, with the nonce and the name Apple
 * shares on the first sign-in, for the app's Bearer token. Rejects like nativeSignIn.
 */
export async function appleSignIn(
  deps: { appleSignIn?: WebAuthPlugin['appleSignIn']; fetch?: typeof fetch } = {}
): Promise<{ token: string; user: Me }> {
  const open = deps.appleSignIn ?? ((o) => WebAuth.appleSignIn(o))
  const nonce = random(24)
  const hashed = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce)))
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const apple = await sheet(() => open({ nonce: hashed }))
  return tradeForToken(deps.fetch ?? fetch, '/auth/apple/token', {
    identityToken: apple.identityToken,
    nonce,
    givenName: apple.givenName,
    familyName: apple.familyName
  })
}
