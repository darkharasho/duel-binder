import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Me } from '@shared/cloud'
import {
  CODE_LENGTH,
  EMAIL_COPY,
  MAX_EMAIL_LEN,
  MAX_PASSWORD,
  emailProblem,
  normalizeEmail,
  passwordProblem,
  passwordPlaceholder,
  type EmailAuthView
} from '@shared/emailAuth'
import { CodeBoxes } from './CodeBoxes'
import type { EmailAuthClient } from './emailClient'

const RESEND_SECONDS = 60
const providerName = (p: string): string => p.charAt(0).toUpperCase() + p.slice(1)

type Screen =
  | { at: 'email' }
  | { at: 'password' }
  | { at: 'create' }
  | { at: 'code'; ticket: string; purpose: 'signup' | 'reset' }
  | { at: 'new-password'; ticket: string }
  | { at: 'match'; ticket: string; providers: string[] }

/**
 * Email and password sign-in, one box at a time: the email, then its password (or a new password
 * for a new email), then the emailed code. `forgotFor` starts at the code for a password reset.
 * The client does the talking; this only follows the portal's `next`.
 */
export function EmailSignIn({
  client,
  onSignedIn,
  onBack,
  forgotFor
}: {
  client: EmailAuthClient
  onSignedIn: (user: Me, created: boolean) => void
  onBack: () => void
  forgotFor?: string
}): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ at: 'email' })
  const [email, setEmail] = useState(forgotFor ?? '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const wait = Math.max(0, Math.ceil((until - now) / 1000))

  // A code was just sent: ask again only after a minute.
  const startWait = (): void => {
    setNow(Date.now())
    setUntil(Date.now() + RESEND_SECONDS * 1000)
  }
  useEffect(() => {
    if (until <= Date.now()) return
    const t = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= until) clearInterval(t)
    }, 500)
    return () => clearInterval(t)
  }, [until])

  const follow = (reply: EmailAuthView): void => {
    setError(null)
    switch (reply.next) {
      case 'password':
      case 'create':
        setEmail(reply.email)
        setPassword('')
        setScreen({ at: reply.next })
        break
      case 'code':
        setEmail(reply.email)
        setCode('')
        setScreen({ at: 'code', ticket: reply.ticket, purpose: reply.purpose })
        startWait()
        break
      case 'new-password':
        setPassword('')
        setScreen({ at: 'new-password', ticket: reply.ticket })
        break
      case 'match':
        setEmail(reply.email)
        setScreen({ at: 'match', ticket: reply.ticket, providers: reply.providers })
        break
      case 'signed-in':
        onSignedIn(reply.user, reply.created)
        break
    }
  }

  const run = async (go: () => Promise<EmailAuthView>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      follow(await go())
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  const forgot = (): Promise<void> => run(() => client.step('forgot', { email }))
  const started = useRef(false)
  useEffect(() => {
    if (!forgotFor || started.current) return
    started.current = true
    void forgot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = (e: React.FormEvent, go: () => void): void => {
    e.preventDefault()
    go()
  }
  const err = error && (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  )
  const passwordBox = (autoComplete: string, label = 'Password'): React.JSX.Element => (
    <Input
      type="password"
      aria-label={label}
      placeholder={passwordPlaceholder(label, autoComplete)}
      autoComplete={autoComplete}
      maxLength={MAX_PASSWORD}
      value={password}
      onChange={(e) => setPassword(e.target.value)}
    />
  )
  const codeReady = new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)
  const wrongPassword = error === EMAIL_COPY.wrongPassword
  const form = 'flex w-full max-w-xs flex-col gap-3 text-left'

  if (screen.at === 'email') {
    const bad = emailProblem(normalizeEmail(email))
    return (
      <form
        className={form}
        onSubmit={(e) =>
          submit(e, () => {
            if (!bad) void run(() => client.step('check', { email: normalizeEmail(email) }))
          })
        }
      >
        <Input
          type="email"
          aria-label="Email"
          placeholder="Email"
          autoComplete="email"
          inputMode="email"
          maxLength={MAX_EMAIL_LEN}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{EMAIL_COPY.oneBox}</p>
        {err}
        <Button type="submit" disabled={busy || bad !== null}>
          Continue
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
          Back
        </Button>
      </form>
    )
  }

  if (screen.at === 'password' || screen.at === 'create') {
    const creating = screen.at === 'create'
    const bad = creating ? passwordProblem(password) : password ? null : 'Enter your password'
    return (
      <form
        className={form}
        onSubmit={(e) =>
          submit(e, () => {
            if (!bad)
              void run(() => client.step(creating ? 'create' : 'password', { email, password }))
          })
        }
      >
        <p className="text-sm font-medium">{email}</p>
        {creating && (
          <p className="text-sm text-muted-foreground">Choose a password to make your account.</p>
        )}
        {passwordBox(creating ? 'new-password' : 'current-password')}
        {!wrongPassword && err}
        <Button type="submit" disabled={busy || bad !== null}>
          {creating ? 'Create account' : 'Sign in'}
        </Button>
        {wrongPassword && err}
        {!creating && (
          <Button
            type="button"
            variant={wrongPassword ? 'outline' : 'link'}
            className={wrongPassword ? undefined : 'h-auto p-0'}
            disabled={busy}
            onClick={() => void forgot()}
          >
            Forgot password?
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setError(null)
            setScreen({ at: 'email' })
          }}
        >
          Back
        </Button>
      </form>
    )
  }

  if (screen.at === 'code') {
    const { ticket } = screen
    return (
      <form
        className={form}
        onSubmit={(e) =>
          submit(e, () => {
            if (codeReady) void run(() => client.step('confirm', { ticket, code }))
          })
        }
      >
        <p className="text-sm text-muted-foreground">We sent a code to {email}.</p>
        <CodeBoxes value={code} onChange={setCode} disabled={busy} />
        {err}
        <Button type="submit" disabled={busy || !codeReady}>
          Confirm
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || wait > 0}
          onClick={() => void run(() => client.step('resend', { ticket }))}
        >
          Send a new code
        </Button>
        {wait > 0 && <p className="text-xs text-muted-foreground">You can ask again in {wait}s.</p>}
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setError(null)
            setScreen({ at: 'email' })
          }}
        >
          Back
        </Button>
      </form>
    )
  }

  if (screen.at === 'new-password') {
    const { ticket } = screen
    const bad = passwordProblem(password)
    return (
      <form
        className={form}
        onSubmit={(e) =>
          submit(e, () => {
            if (!bad) void run(() => client.step('reset', { ticket, password }))
          })
        }
      >
        <p className="text-sm text-muted-foreground">Choose a new password.</p>
        {passwordBox('new-password', 'New password')}
        {err}
        <Button type="submit" disabled={busy || bad !== null}>
          Set password and sign in
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setError(null)
            setScreen({ at: 'email' })
          }}
        >
          Back
        </Button>
      </form>
    )
  }

  const { ticket, providers } = screen
  const canDiscord = client.linkDiscord !== undefined && providers.includes('discord')
  const canApple = client.linkApple !== undefined && providers.includes('apple')
  return (
    <div className={form}>
      <p className="text-sm text-muted-foreground">
        {EMAIL_COPY.matchProvider(providers.map(providerName).join(' and '))}
      </p>
      <p className="text-sm font-medium">{email}</p>
      {!canDiscord && !canApple && (
        <p className="text-sm text-muted-foreground">{EMAIL_COPY.linkOnIphone}</p>
      )}
      {err}
      {canDiscord && (
        <Button disabled={busy} onClick={() => void run(() => client.linkDiscord!(ticket))}>
          Link with Discord
        </Button>
      )}
      {canApple && (
        <Button disabled={busy} onClick={() => void run(() => client.linkApple!(ticket))}>
          Link with Apple
        </Button>
      )}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void run(() => client.step('separate', { ticket }))}
      >
        Make a separate account
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setError(null)
          setScreen({ at: 'email' })
        }}
      >
        Back
      </Button>
    </div>
  )
}
