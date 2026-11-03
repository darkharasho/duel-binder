import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { MergePreview } from '@shared/account'
import {
  CODE_LENGTH,
  EMAIL_COPY,
  MAX_EMAIL_LEN,
  MAX_PASSWORD,
  emailProblem,
  normalizeEmail,
  passwordPlaceholder,
  passwordProblem
} from '@shared/emailAuth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { CodeBoxes } from '@/features/account/CodeBoxes'
import { api } from '@/lib/api'

const KEY = ['account', 'signIns'] as const
const RESEND_SECONDS = 60
const CODE_READY = new RegExp(`^\\d{${CODE_LENGTH}}$`)

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong')

function Shell({
  title,
  description,
  busy,
  onClose,
  children
}: {
  title: string
  description?: string
  busy: boolean
  onClose(): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

const Problem = ({ text }: { text: string | null }): React.JSX.Element | null =>
  text ? (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null

/** Seconds left before another code may be asked for; `start` begins the wait. */
function useResendWait(): [number, () => void] {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const t = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= until) clearInterval(t)
    }, 500)
    return () => clearInterval(t)
  }, [until])
  return [
    Math.max(0, Math.ceil((until - now) / 1000)),
    () => {
      setNow(Date.now())
      setUntil(Date.now() + RESEND_SECONDS * 1000)
    }
  ]
}

/**
 * The two-step flow Add email and Change email share: an email and a password, then the mailed
 * code. `send` answers the portal's result for the form; the caller decides what each means.
 */
function EmailCodeFlow({
  title,
  passwordLabel,
  passwordAutoComplete,
  submitLabel,
  send,
  onClose
}: {
  title: string
  passwordLabel: string
  passwordAutoComplete: string
  submitLabel: string
  send(email: string, password: string): Promise<{ ticket: string } | { stop: string | null }>
  onClose(): void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, startWait] = useResendWait()

  const run = async (go: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await go()
    } catch (e) {
      setError(messageOf(e))
    }
    setBusy(false)
  }
  const address = normalizeEmail(email)
  const formBad = emailProblem(address) ?? (password ? null : 'Enter your password')

  if (done) {
    return (
      <Shell title={title} description="Done." busy={false} onClose={onClose}>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </Shell>
    )
  }

  if (ticket) {
    return (
      <Shell
        title={title}
        description={`We sent a code to ${address}.`}
        busy={busy}
        onClose={onClose}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!CODE_READY.test(code)) return
            void run(async () => {
              await api.account.confirmEmail(ticket, code)
              await qc.invalidateQueries({ queryKey: KEY })
              setDone(true)
            })
          }}
        >
          <CodeBoxes value={code} onChange={setCode} disabled={busy} />
          <Problem text={error} />
          <Button type="submit" disabled={busy || !CODE_READY.test(code)}>
            Confirm
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || wait > 0}
            onClick={() =>
              void run(async () => {
                const out = await api.account.resendEmailCode(ticket)
                setTicket(out.ticket)
                setCode('')
                startWait()
              })
            }
          >
            Send a new code
          </Button>
          {wait > 0 && (
            <p className="text-xs text-muted-foreground">You can ask again in {wait}s.</p>
          )}
        </form>
      </Shell>
    )
  }

  return (
    <Shell title={title} busy={busy} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (formBad) return
          void run(async () => {
            const out = await send(address, password)
            if ('ticket' in out) {
              setTicket(out.ticket)
              setCode('')
              startWait()
            } else if (out.stop) setError(out.stop)
          })
        }}
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
        <Input
          type="password"
          aria-label={passwordLabel}
          placeholder={passwordPlaceholder(passwordLabel, passwordAutoComplete)}
          autoComplete={passwordAutoComplete}
          maxLength={MAX_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Problem text={error} />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || formBad !== null}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Shell>
  )
}

/**
 * Add an email sign-in: email and password, then the mailed code. When another account already
 * uses the address and the portal offers a merge, `onMerge` takes it (the phone's merge screen);
 * without it the person is pointed at the phone app.
 */
export function AddEmailDialog({
  onClose,
  onMerge
}: {
  onClose(): void
  onMerge?(ticket: string, preview: MergePreview): void
}): React.JSX.Element {
  const qc = useQueryClient()
  return (
    <EmailCodeFlow
      title="Add email sign-in"
      passwordLabel="Password"
      passwordAutoComplete="new-password"
      submitLabel="Send code"
      onClose={onClose}
      send={async (email, password) => {
        const out = await api.account.addEmail(email, password)
        switch (out.status) {
          case 'code':
            return { ticket: out.ticket }
          case 'merge':
            if (!onMerge) return { stop: EMAIL_COPY.mergeOnPhone }
            onMerge(out.ticket, out.preview)
            onClose()
            return { stop: null }
          case 'has-provider':
            return { stop: EMAIL_COPY.alsoHas(out.provider ?? 'email') }
          default:
            // linked, or already there
            await qc.invalidateQueries({ queryKey: KEY })
            onClose()
            return { stop: null }
        }
      }}
    />
  )
}

/** Change the address: the current password and the new email, then the code sent to the new one. */
export function ChangeEmailDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <EmailCodeFlow
      title="Change email"
      passwordLabel="Current password"
      passwordAutoComplete="current-password"
      submitLabel="Send code"
      onClose={onClose}
      send={async (email, password) => {
        const out = await api.account.changeEmail(password, email)
        return { ticket: out.ticket }
      }}
    />
  )
}

/** Change the email sign-in's password. */
export function ChangePasswordDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bad = current ? passwordProblem(next) : 'Enter your current password'

  if (done) {
    return (
      <Shell title="Change password" description="Password changed." busy={false} onClose={onClose}>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </Shell>
    )
  }
  return (
    <Shell title="Change password" busy={busy} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (bad) return
          setBusy(true)
          setError(null)
          api.account
            .changePassword(current, next)
            .then(() => setDone(true))
            .catch((err) => setError(messageOf(err)))
            .finally(() => setBusy(false))
        }}
      >
        <Input
          type="password"
          aria-label="Current password"
          placeholder="Current password"
          autoComplete="current-password"
          maxLength={MAX_PASSWORD}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          type="password"
          aria-label="New password"
          placeholder={passwordPlaceholder('New password', 'new-password')}
          autoComplete="new-password"
          maxLength={MAX_PASSWORD}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Problem text={error} />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || bad !== null}>
            Change password
          </Button>
        </DialogFooter>
      </form>
    </Shell>
  )
}
