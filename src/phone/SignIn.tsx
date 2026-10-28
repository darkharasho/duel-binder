import { useState } from 'react'
import { isNativeApp } from '@/lib/portal'
import { fetchMe } from '@/web/account'
import type { Me } from '../shared/cloud'
import { NATIVE_SIGN_IN_COPY, SIGN_IN_COPY, SIGN_IN_FAILED, SIGN_IN_URL } from './copy'
import { appleSignIn, nativeSignIn, SignInCancelled } from './nativeSignIn'
import type { PhoneStore } from './data/store'
import { PhoneScreen } from './PhoneScreen'
import { useMounted, useOnce } from './useOnce'

const BUTTON =
  'flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-xl text-base font-semibold transition-opacity active:opacity-80'
const DISCORD_BUTTON = `${BUTTON} bg-[#5865F2] text-white`
/** Apple's white style, for dark backgrounds. */
const APPLE_BUTTON = `${BUTTON} bg-white text-black`

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
  const failed =
    nativeFailed || new URLSearchParams(window.location.search).get('signin') === 'failed'

  const mounted = useMounted()
  const signInNative = async (
    signInWith: () => Promise<{ token: string; user: Me }>
  ): Promise<void> => {
    setNativeFailed(false)
    setChecking(true)
    try {
      const signedIn = await signInWith()
      if (!mounted.current) return
      await store.signIn(signedIn.token, signedIn.user)
      if (mounted.current) onSignedIn(signedIn.user)
      return
    } catch (e) {
      if (mounted.current && !(e instanceof SignInCancelled)) setNativeFailed(true)
    }
    if (mounted.current) setChecking(false)
  }
  useOnce(() => {
    if (native) return
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
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Duel Binder</h1>
        <p className="max-w-xs text-base text-muted-foreground">
          {native ? NATIVE_SIGN_IN_COPY : SIGN_IN_COPY}
        </p>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {SIGN_IN_FAILED}
        </p>
      )}
      {checking ? (
        <p role="status" className="flex h-12 items-center text-sm text-muted-foreground">
          Checking sign-in…
        </p>
      ) : native ? (
        <div className="flex w-full flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => void signInNative(appleSignIn)}
            className={APPLE_BUTTON}
          >
            <AppleLogo />
            Sign in with Apple
          </button>
          <button
            type="button"
            onClick={() => void signInNative(nativeSignIn)}
            className={DISCORD_BUTTON}
          >
            Sign in with Discord
          </button>
        </div>
      ) : (
        <a href={SIGN_IN_URL} className={DISCORD_BUTTON}>
          Sign in with Discord
        </a>
      )}
    </PhoneScreen>
  )
}
