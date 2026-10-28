import { useState } from 'react'
import { isNativeApp } from '@/lib/portal'
import { fetchMe } from '@/web/account'
import type { Me } from '../shared/cloud'
import { SIGN_IN_COPY, SIGN_IN_FAILED, SIGN_IN_URL } from './copy'
import { nativeSignIn, SignInCancelled } from './nativeSignIn'
import type { PhoneStore } from './data/store'
import { PhoneScreen } from './PhoneScreen'
import { useMounted, useOnce } from './useOnce'

const DISCORD_BUTTON =
  'flex h-12 w-full max-w-xs items-center justify-center rounded-xl bg-[#5865F2] text-base font-semibold text-white transition-opacity active:opacity-80'

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
 * The iOS app has no web session: its button opens the system sign-in sheet (nativeSignIn).
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
  const signInNative = async (): Promise<void> => {
    setNativeFailed(false)
    setChecking(true)
    try {
      const signedIn = await nativeSignIn()
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
        <p className="max-w-xs text-base text-muted-foreground">{SIGN_IN_COPY}</p>
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
        <button type="button" onClick={() => void signInNative()} className={DISCORD_BUTTON}>
          Sign in with Discord
        </button>
      ) : (
        <a href={SIGN_IN_URL} className={DISCORD_BUTTON}>
          Sign in with Discord
        </a>
      )}
    </PhoneScreen>
  )
}
