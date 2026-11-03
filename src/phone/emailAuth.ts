import type { EmailAuthClient } from '@/features/account/emailClient'
import { APP_PLATFORM, PORTAL_ORIGIN } from '@/lib/portal'
import {
  EMAIL_COPY,
  type EmailAuthReply,
  type EmailAuthView,
  type EmailStep
} from '../shared/emailAuth'
import type { PhoneStore } from './data/store'
import { appleSheet, nativeSignIn, SignInCancelled } from './nativeSignIn'

const OFFLINE = "Can't reach Duel Binder. Check your connection and try again."

/** Whether the portal has email sign-in on; any failure counts as off. */
export async function emailSignInEnabled(doFetch: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await doFetch(`${PORTAL_ORIGIN}/auth/email/status`)
    if (!res.ok) return false
    return ((await res.json()) as { enabled?: unknown }).enabled === true
  } catch {
    return false
  }
}

/**
 * The phone app's email sign-in client: each step is a JSON POST to the portal, whose signed-in
 * reply carries an app token that goes to the store, never to the screens. Linking a Discord or
 * Apple sign-in to the email account uses the same system sheets as signing in with them (Apple
 * only where the app has the sheet, on iOS).
 */
export function phoneEmailClient(
  store: Pick<PhoneStore, 'signIn'>,
  doFetch: typeof fetch = fetch
): EmailAuthClient {
  const step = async (name: EmailStep, body: Record<string, unknown>): Promise<EmailAuthView> => {
    let res: Response
    try {
      res = await doFetch(`${PORTAL_ORIGIN}/auth/email/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch {
      throw new Error(OFFLINE)
    }
    let out: unknown
    try {
      out = await res.json()
    } catch {
      out = null
    }
    if (!res.ok) {
      const message = (out as { error?: unknown } | null)?.error
      throw new Error(typeof message === 'string' ? message : EMAIL_COPY.linkFailed)
    }
    const reply = out as EmailAuthReply
    if (reply.next !== 'signed-in') return reply
    await store.signIn(reply.token, reply.user)
    return { next: 'signed-in', user: reply.user, created: reply.created }
  }

  // A closed sheet is not an error worth showing: an empty message says so.
  const sheet = async <T>(open: () => Promise<T>): Promise<T> => {
    try {
      return await open()
    } catch (e) {
      throw e instanceof SignInCancelled ? new Error('') : new Error(EMAIL_COPY.linkFailed)
    }
  }

  const client: EmailAuthClient = {
    step,
    linkDiscord: async (ticket) => {
      const { code, verifier } = await sheet(() => nativeSignIn({ intent: 'link' }))
      return step('link-discord', { ticket, code, verifier })
    }
  }
  if (APP_PLATFORM === 'ios') {
    client.linkApple = async (ticket) => {
      const { identityToken, nonce } = await sheet(() => appleSheet())
      return step('link-apple', { ticket, identityToken, nonce })
    }
  }
  return client
}

/** The same client for a Discord or Apple claim: the claim steps also carry its ticket and PKCE verifier. */
export function claimEmailClient(
  client: EmailAuthClient,
  claim: { claim: string; verifier?: string }
): EmailAuthClient {
  return {
    step: (name, body) =>
      client.step(
        name,
        name === 'claim' || name === 'claim-separate'
          ? {
              ...body,
              ticket: claim.claim,
              ...(claim.verifier ? { verifier: claim.verifier } : {})
            }
          : body
      )
  }
}
