import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Me } from '@shared/cloud'
import { EMAIL_COPY, MAX_PASSWORD } from '@shared/emailAuth'
import type { EmailAuthClient } from './emailClient'

/**
 * A first Discord or Apple sign-in whose email an email account uses: enter that account's
 * password to link the sign-in to it, or make a separate account. The client already knows the
 * claim's ticket (and PKCE verifier); this sends only the password.
 */
export function EmailClaim({
  email,
  provider,
  client,
  onSignedIn,
  onForgot,
  onCancel
}: {
  email: string
  provider: string
  client: EmailAuthClient
  onSignedIn: (user: Me, created: boolean) => void
  onForgot: () => void
  onCancel?: () => void
}): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (step: 'claim' | 'claim-separate'): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const reply = await client.step(step, step === 'claim' ? { password } : {})
      if (reply.next === 'signed-in') onSignedIn(reply.user, reply.created)
      else setError(EMAIL_COPY.codeExpired)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <form
      className="flex w-full max-w-xs flex-col gap-3 text-left"
      onSubmit={(e) => {
        e.preventDefault()
        if (password) void run('claim')
      }}
    >
      <p className="text-sm text-muted-foreground">{EMAIL_COPY.matchClaim(provider)}</p>
      <p className="text-sm font-medium">{email}</p>
      <Input
        type="password"
        aria-label="Password"
        placeholder="Password"
        autoComplete="current-password"
        maxLength={MAX_PASSWORD}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !password}>
        Link
      </Button>
      <Button
        type="button"
        variant="link"
        className="h-auto p-0"
        disabled={busy}
        onClick={onForgot}
      >
        Forgot password?
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => void run('claim-separate')}
      >
        Make a separate account
      </Button>
      {onCancel && (
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      )}
    </form>
  )
}
