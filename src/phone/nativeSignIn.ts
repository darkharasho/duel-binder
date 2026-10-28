import { registerPlugin } from '@capacitor/core'
import type { Me } from '../shared/cloud'
import { PORTAL_ORIGIN } from '@/lib/portal'

/**
 * The iOS app's sign-in plugin (ios/App/App/WebAuthPlugin.swift): an ASWebAuthenticationSession
 * that opens `url` and resolves with the URL it ended at on `callbackScheme`.
 */
interface WebAuthPlugin {
  start(options: { url: string; callbackScheme: string }): Promise<{ url: string }>
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

  let ended: string
  try {
    ended = (await start({ url: startUrl, callbackScheme: CALLBACK_SCHEME })).url
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'CANCELLED') throw new SignInCancelled()
    throw e
  }
  const q = new URL(ended).searchParams
  const code = q.get('code')
  if (q.get('state') !== state || q.has('error') || !code) throw new Error('signin-failed')

  const res = await doFetch(`${PORTAL_ORIGIN}/auth/desktop/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier })
  })
  if (!res.ok) throw new Error('signin-failed')
  const body = (await res.json()) as { token?: unknown; user?: Me }
  if (typeof body.token !== 'string' || !body.user) throw new Error('signin-failed')
  return { token: body.token, user: body.user }
}
