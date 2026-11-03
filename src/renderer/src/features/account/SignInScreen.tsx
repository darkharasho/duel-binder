import { useEffect, useState } from 'react'
import logo from '@/assets/logo.svg'
import { TitleBar } from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useApplyAccountStatus } from '@/lib/account'
import type { AccountStatus } from '@shared/types'
import { EmailClaim } from './EmailClaim'
import { EmailSignIn } from './EmailSignIn'
import type { EmailAuthClient } from './emailClient'

/** The email flow over the desktop's IPC: the session token stays in the main process. */
const emailClient: EmailAuthClient = {
  step: (step, body) => api.account.emailAuth(step, body),
  linkDiscord: (ticket) => api.account.emailLinkDiscord(ticket)
}

/** The claim steps: main already holds the ticket and verifier, so only the password goes over. */
const claimClient: EmailAuthClient = {
  step: (step, body) =>
    step === 'claim-separate'
      ? api.account.claim(null)
      : step === 'claim'
        ? api.account.claim(typeof body.password === 'string' ? body.password : '')
        : api.account.emailAuth(step, body)
}

/** Full-window gate shown instead of the app while the desktop has no signed-in account. */
export function SignInScreen({ status }: { status?: AccountStatus }): React.JSX.Element {
  const apply = useApplyAccountStatus()
  const [emailOn, setEmailOn] = useState(false)
  /** The email sign-in screens; `forgotFor` starts at a password reset for that address. */
  const [emailFlow, setEmailFlow] = useState<null | { forgotFor?: string }>(null)
  useEffect(() => {
    let live = true
    api.account
      .emailEnabled()
      .then((on) => live && setEmailOn(on))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const signedIn = (): void => apply(api.account.status())
  const claim = status?.claim
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar />
      <main className="flex flex-1 items-center justify-center px-6 pb-9">
        <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
          <img src={logo} alt="" className="size-14" />
          {emailFlow ? (
            <EmailSignIn
              client={emailClient}
              forgotFor={emailFlow.forgotFor}
              onSignedIn={signedIn}
              onBack={() => setEmailFlow(null)}
            />
          ) : claim ? (
            <EmailClaim
              email={claim.email}
              provider={claim.provider}
              client={claimClient}
              onSignedIn={signedIn}
              onCancel={() => apply(api.account.signOut())}
              onForgot={() => setEmailFlow({ forgotFor: claim.email })}
            />
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-[-0.01em]">Sign in to Duel Binder</h1>
              <p className="text-sm text-muted-foreground">
                Duel Binder keeps your collection and card data in your account. Sign in with
                Discord to continue.
              </p>
              {status?.state === 'signing-in' ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    Finish signing in in your browser…
                  </p>
                  <Button variant="outline" onClick={() => apply(api.account.signOut())}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Button onClick={() => apply(api.account.signIn())}>Sign in with Discord</Button>
                  {emailOn && (
                    <Button variant="outline" onClick={() => setEmailFlow({})}>
                      Continue with email
                    </Button>
                  )}
                </div>
              )}
              {status?.error && <p className="text-sm text-destructive">{status.error}</p>}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
