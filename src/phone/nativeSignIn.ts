import { registerPlugin } from '@capacitor/core'
import type { Me } from '../shared/cloud'
import { APP_PLATFORM, PORTAL_ORIGIN } from '@/lib/portal'

/**
 * The apps' sign-in plugin (ios/App/App/WebAuthPlugin.swift, and WebAuthPlugin.java on Android):
 * `start` opens `url` in the system's sign-in sheet (ASWebAuthenticationSession on iOS, a Custom
 * Tab on Android) and resolves with the URL it ended at on `callbackScheme`; `appleSignIn`, iOS
 * only, is Sign in with Apple, with `nonce` the SHA-256 (hex) of the
 * app's random value. Both reject with the code CANCELLED when the sheet is closed.
 */
interface WebAuthPlugin {
  start(options: { url: string; callbackScheme: string }): Promise<{ url: string }>
  appleSignIn(options: { nonce: string }): Promise<{
    identityToken: string
    authorizationCode?: string
    givenName?: string
    familyName?: string
  }>
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
 * Discord sign-in for the iOS and Android apps: the portal's desktop flow (`?app=ios` or
 * `?app=android`) with a PKCE challenge,
 * shown in the system's sign-in sheet, which hands back a one-time code on duelbinder://; the code
 * and verifier trade for the app's Bearer token like the desktop's. Rejects with SignInCancelled
 * when the sheet is closed, and with an Error when the sign-in fails.
 */
export async function nativeSignIn(deps: {
  app?: 'ios' | 'android'
  intent: 'link'
  start?: WebAuthPlugin['start']
  fetch?: typeof fetch
}): Promise<{ code: string; verifier: string }>
export async function nativeSignIn(deps?: {
  app?: 'ios' | 'android'
  start?: WebAuthPlugin['start']
  fetch?: typeof fetch
}): Promise<{ token: string; user: Me }>
export async function nativeSignIn(
  deps: {
    app?: 'ios' | 'android'
    intent?: 'link'
    start?: WebAuthPlugin['start']
    fetch?: typeof fetch
  } = {}
): Promise<{ token: string; user: Me } | { code: string; verifier: string }> {
  const app = deps.app ?? (APP_PLATFORM === 'android' ? 'android' : 'ios')
  const start = deps.start ?? ((o) => WebAuth.start(o))
  const doFetch = deps.fetch ?? fetch
  const state = random(24)
  const verifier = random(48)
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  )
  const params = new URLSearchParams({ app, state, challenge })
  if (deps.intent === 'link') params.set('intent', 'link')
  const startUrl = `${PORTAL_ORIGIN}/auth/desktop/start?${params}`

  const { url: ended } = await sheet(() =>
    start({ url: startUrl, callbackScheme: CALLBACK_SCHEME })
  )
  const q = new URL(ended).searchParams
  const code = q.get('code')
  if (q.get('state') !== state || q.has('error') || !code) throw new Error('signin-failed')
  // Linking hands the code to the signed-in portal call instead of trading it for a token.
  if (deps.intent === 'link') return { code, verifier }
  return tradeForToken(doFetch, '/auth/desktop/token', { code, verifier })
}

/**
 * Sign in with Apple for the iOS app: the system's Apple sheet signs a token for a random nonce
 * (Apple gets its SHA-256), which the portal checks and trades, with the nonce and the name Apple
 * shares on the first sign-in, for the app's Bearer token. The authorization code goes along so
 * the portal can revoke the Apple sign-in when the account is deleted. Rejects like nativeSignIn.
 */
export async function appleSignIn(
  deps: { appleSignIn?: WebAuthPlugin['appleSignIn']; fetch?: typeof fetch } = {}
): Promise<{ token: string; user: Me }> {
  const apple = await appleSheet(deps)
  return tradeForToken(deps.fetch ?? fetch, '/auth/apple/token', {
    identityToken: apple.identityToken,
    authorizationCode: apple.authorizationCode,
    nonce: apple.nonce,
    givenName: apple.givenName,
    familyName: apple.familyName
  })
}

/**
 * The Apple sheet alone: the identity token Apple signed for a random nonce, with that nonce (the
 * raw value; Apple got its SHA-256) and the authorization code. Sign-in trades them for a token;
 * linking sends them to the signed-in portal call. Rejects with SignInCancelled when closed.
 */
export async function appleSheet(
  deps: { appleSignIn?: WebAuthPlugin['appleSignIn'] } = {}
): Promise<{
  identityToken: string
  nonce: string
  authorizationCode?: string
  givenName?: string
  familyName?: string
}> {
  const open = deps.appleSignIn ?? ((o) => WebAuth.appleSignIn(o))
  const nonce = random(24)
  const hashed = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce)))
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const apple = await sheet(() => open({ nonce: hashed }))
  return { ...apple, nonce }
}
