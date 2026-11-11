import { useMemo, useState } from 'react'
import { APP_PLATFORM, isNativeApp } from '@/lib/portal'
import { fetchMe } from '@/web/account'
import type { Me } from '../shared/cloud'
import { EmailClaim } from '@/features/account/EmailClaim'
import { EmailSignIn } from '@/features/account/EmailSignIn'
import { claimEmailClient, emailSignInEnabled, phoneEmailClient } from './emailAuth'
import { NATIVE_SIGN_IN_COPY, SIGN_IN_COPY, SIGN_IN_FAILED, SIGN_IN_URL } from './copy'
import { appleSignIn, nativeSignIn, SignInCancelled, type SignInResult } from './nativeSignIn'
import type { PhoneStore } from './data/store'
import { PhoneScreen } from './PhoneScreen'
import { useMounted, useOnce } from './useOnce'

const BUTTON =
  'flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-base font-semibold transition-opacity active:opacity-80'
const DISCORD_BUTTON = `${BUTTON} bg-[#5865F2] text-white`
/** Apple's white style, for dark backgrounds. */
const APPLE_BUTTON = `${BUTTON} bg-white text-black`
const EMAIL_BUTTON = `${BUTTON} border border-border text-foreground`
/** Where the browser's email sign-in comes back to /scan/. */
const EMAIL_URL = '/auth/email?next=scan'

/** Whether the portal has email sign-in on; any failure counts as off. */
async function emailSignInOn(): Promise<boolean> {
  try {
    const res = await fetch('/auth/email/status')
    if (!res.ok) return false
    return ((await res.json()) as { enabled?: unknown }).enabled === true
  } catch {
    return false
  }
}

function AppleLogo(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 17 20" className="h-5 w-[17px] fill-current">
      <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.1ZM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z" />
    </svg>
  )
}

/**
 * Trades the web session cookie for the phone's own token (POST /auth/phone/token, same origin,
 * JSON so a cross-site page can't), once: the store keeps the token. Null when signed out of the
 * web or the trade fails.
 */
async function exchangeCookie(): Promise<{ token: string; user: Me } | null> {
  const me = await fetchMe()
  if (!me) return null
  const res = await fetch('/auth/phone/token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  if (!res.ok) return null
  const body = (await res.json()) as { token?: unknown; user?: Me }
  return typeof body.token === 'string' && body.user ? { token: body.token, user: body.user } : null
}

/**
 * Signed out. A web session already open in this browser signs the phone in without a click;
 * otherwise it offers Discord sign-in, which comes back to /scan/ (or /scan/?signin=failed).
 * The iOS app has no web session: it offers Sign in with Apple and Discord in the system's sheets
 * (nativeSignIn.ts).
 */
export function SignIn({
  store,
  onSignedIn
}: {
  store: PhoneStore
  onSignedIn: (user: Me) => void
}): React.JSX.Element {
  const native = isNativeApp()
  const [checking, setChecking] = useState(!native)
  const [nativeFailed, setNativeFailed] = useState(false)
  const [emailOn, setEmailOn] = useState(false)
  /** The in-app email flow (`forgot`: straight to a password reset) or a claim to link. */
  const [emailFlow, setEmailFlow] = useState<
    | null
    | { at: 'email'; forgotFor?: string }
    | { at: 'claim'; email: string; provider: string; claim: string; verifier?: string }
  >(null)
  const failed =
    nativeFailed || new URLSearchParams(window.location.search).get('signin') === 'failed'

  const mounted = useMounted()
  const emailClient = useMemo(() => phoneEmailClient(store), [store])
  const signInNative = async (
    signInWith: () => Promise<SignInResult>,
    provider: string
  ): Promise<void> => {
    setNativeFailed(false)
    setChecking(true)
    try {
      const signedIn = await signInWith()
      if (!mounted.current) return
      if ('claim' in signedIn) {
        // An email account uses this email: link to it with its password, or go separate.
        setEmailFlow({ at: 'claim', provider, ...signedIn })
        setChecking(false)
        return
      }
      await store.signIn(signedIn.token, signedIn.user)
      if (mounted.current) onSignedIn(signedIn.user)
      return
    } catch (e) {
      if (mounted.current && !(e instanceof SignInCancelled)) setNativeFailed(true)
    }
    if (mounted.current) setChecking(false)
  }
  useOnce(() => {
    if (native) {
      void emailSignInEnabled().then((on) => {
        if (mounted.current) setEmailOn(on)
      })
      return
    }
    void emailSignInOn().then((on) => {
      if (mounted.current) setEmailOn(on)
    })
    void (async () => {
      try {
        const signedIn = await exchangeCookie()
        if (!mounted.current) return
        if (signedIn) {
          await store.signIn(signedIn.token, signedIn.user)
          if (mounted.current) onSignedIn(signedIn.user)
          return
        }
      } catch {
        // Offline or the portal failed: the button still works once it's back.
      }
      if (mounted.current) setChecking(false)
    })()
  })

  return (
    <PhoneScreen>
      {/* The name is set big above, as the brand; this names the page for screen readers. */}
      <h1 className="sr-only">Duel Binder</h1>
      <p className="max-w-xs text-[15px] text-muted-foreground">
        {native ? NATIVE_SIGN_IN_COPY : SIGN_IN_COPY}
      </p>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {SIGN_IN_FAILED}
        </p>
      )}
      {checking ? (
        <p role="status" className="flex h-12 items-center text-sm text-muted-foreground">
          Checking sign-in…
        </p>
      ) : native && emailFlow?.at === 'email' ? (
        <EmailSignIn
          client={emailClient}
          forgotFor={emailFlow.forgotFor}
          onSignedIn={(user) => onSignedIn(user)}
          onBack={() => setEmailFlow(null)}
        />
      ) : native && emailFlow?.at === 'claim' ? (
        <EmailClaim
          email={emailFlow.email}
          provider={emailFlow.provider}
          client={claimEmailClient(emailClient, emailFlow)}
          onSignedIn={(user) => onSignedIn(user)}
          onCancel={() => setEmailFlow(null)}
          onForgot={() => setEmailFlow({ at: 'email', forgotFor: emailFlow.email })}
        />
      ) : native ? (
        <div className="flex w-full flex-col items-center gap-3">
          {APP_PLATFORM === 'ios' && (
            <button
              type="button"
              onClick={() => void signInNative(appleSignIn, 'apple')}
              className={APPLE_BUTTON}
            >
              <AppleLogo />
              Sign in with Apple
            </button>
          )}
          <button
            type="button"
            onClick={() => void signInNative(nativeSignIn, 'discord')}
            className={DISCORD_BUTTON}
          >
            Sign in with Discord
          </button>
          {emailOn && (
            <button
              type="button"
              onClick={() => setEmailFlow({ at: 'email' })}
              className={EMAIL_BUTTON}
            >
              Continue with email
            </button>
          )}
        </div>
      ) : (
        <div className="flex w-full flex-col items-center gap-3">
          <a href={SIGN_IN_URL} className={DISCORD_BUTTON}>
            Sign in with Discord
          </a>
          {emailOn && (
            <a href={EMAIL_URL} className={EMAIL_BUTTON}>
              Continue with email
            </a>
          )}
        </div>
      )}
    </PhoneScreen>
  )
}
