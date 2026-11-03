import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailSignIn } from '@/features/account/EmailSignIn'
import type { EmailAuthClient } from '@/features/account/emailClient'
import { EMAIL_COPY, type EmailAuthView } from '@shared/emailAuth'

const USER = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }

/** A client whose steps answer from `replies`, in order; an Error is a refusal. */
function fakeClient(
  replies: (EmailAuthView | Error)[],
  extra: Partial<EmailAuthClient> = {}
): EmailAuthClient & { step: ReturnType<typeof vi.fn> } {
  const queue = [...replies]
  const step = vi.fn(async () => {
    const r = queue.shift()
    if (!r) throw new Error('unexpected step')
    if (r instanceof Error) throw r
    return r
  })
  return { step, ...extra } as never
}

const code = (purpose: 'signup' | 'reset' = 'signup'): EmailAuthView => ({
  next: 'code',
  ticket: 'tk',
  email: 'a@b.co',
  purpose
})

async function enterEmail(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Email'), 'a@b.co')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

afterEach(() => vi.useRealTimers())

describe('EmailSignIn', () => {
  it('new email -> create -> code -> signed in', async () => {
    const user = userEvent.setup()
    const onSignedIn = vi.fn()
    const client = fakeClient([
      { next: 'create', email: 'a@b.co' },
      code(),
      { next: 'signed-in', user: USER, created: true }
    ])
    render(<EmailSignIn client={client} onSignedIn={onSignedIn} onBack={() => {}} />)
    expect(screen.getByText(EMAIL_COPY.oneBox)).toBeInTheDocument()
    await enterEmail(user)
    await user.type(screen.getByLabelText('Password'), 'hunter22!')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await user.type(screen.getByLabelText('Digit 1'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(client.step.mock.calls.map((c) => c[0])).toEqual(['check', 'create', 'confirm'])
    expect(client.step).toHaveBeenLastCalledWith('confirm', { ticket: 'tk', code: '123456' })
    expect(onSignedIn).toHaveBeenCalledWith(USER, true)
  })

  it('known email -> wrong password shows the copy and Forgot password?', async () => {
    const user = userEvent.setup()
    const client = fakeClient([
      { next: 'password', email: 'a@b.co' },
      new Error(EMAIL_COPY.wrongPassword)
    ])
    render(<EmailSignIn client={client} onSignedIn={() => {}} onBack={() => {}} />)
    await enterEmail(user)
    await user.type(screen.getByLabelText('Password'), 'nope-nope')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(EMAIL_COPY.wrongPassword)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument()
  })

  it('forgot -> code -> new password signs in', async () => {
    const user = userEvent.setup()
    const onSignedIn = vi.fn()
    const client = fakeClient([
      { next: 'password', email: 'a@b.co' },
      code('reset'),
      { next: 'new-password', ticket: 'tk2' },
      { next: 'signed-in', user: USER, created: false }
    ])
    render(<EmailSignIn client={client} onSignedIn={onSignedIn} onBack={() => {}} />)
    await enterEmail(user)
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(client.step).toHaveBeenLastCalledWith('forgot', { email: 'a@b.co' })
    await user.type(screen.getByLabelText('Digit 1'), '654321')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await user.type(screen.getByLabelText('New password'), 'brand-new-pw')
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }))
    expect(client.step).toHaveBeenLastCalledWith('reset', {
      ticket: 'tk2',
      password: 'brand-new-pw'
    })
    expect(onSignedIn).toHaveBeenCalledWith(USER, false)
  })

  it('pasting 123456 into the first box fills all six', async () => {
    const user = userEvent.setup()
    const client = fakeClient([{ next: 'create', email: 'a@b.co' }, code()])
    render(<EmailSignIn client={client} onSignedIn={() => {}} onBack={() => {}} />)
    await enterEmail(user)
    await user.type(screen.getByLabelText('Password'), 'hunter22!')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    const first = screen.getByLabelText('Digit 1')
    expect(first).toHaveAttribute('autocomplete', 'one-time-code')
    await user.click(first)
    await user.paste('123456')
    for (let i = 1; i <= 6; i++) expect(screen.getByLabelText(`Digit ${i}`)).toHaveValue(String(i))
  })

  it('Send a new code is disabled for 60 seconds, and Back returns to the email', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = fakeClient([{ next: 'create', email: 'a@b.co' }, code(), code()])
    render(<EmailSignIn client={client} onSignedIn={() => {}} onBack={() => {}} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'hunter22!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    const resend = await screen.findByRole('button', { name: 'Send a new code' })
    expect(resend).toBeDisabled()
    await act(() => vi.advanceTimersByTimeAsync(59_000))
    expect(resend).toBeDisabled()
    await act(() => vi.advanceTimersByTimeAsync(1_500))
    expect(resend).toBeEnabled()
    fireEvent.click(resend)
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(client.step).toHaveBeenLastCalledWith('resend', { ticket: 'tk' })
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  const match: EmailAuthView = {
    next: 'match',
    ticket: 'mt',
    email: 'a@b.co',
    providers: ['discord']
  }

  it('match without linkDiscord shows only Make a separate account', async () => {
    const user = userEvent.setup()
    const client = fakeClient([match])
    render(<EmailSignIn client={client} onSignedIn={() => {}} onBack={() => {}} />)
    await enterEmail(user)
    expect(screen.getByRole('button', { name: 'Make a separate account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Link/ })).toBeNull()
    expect(screen.getByText(EMAIL_COPY.mergeOnPhone)).toBeInTheDocument()
  })

  it('match with linkDiscord calls it with the ticket', async () => {
    const user = userEvent.setup()
    const onSignedIn = vi.fn()
    const linkDiscord = vi.fn(
      async () => ({ next: 'signed-in', user: USER, created: false }) as const
    )
    const client = fakeClient([match], { linkDiscord })
    render(<EmailSignIn client={client} onSignedIn={onSignedIn} onBack={() => {}} />)
    await enterEmail(user)
    expect(screen.queryByRole('button', { name: /Apple/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Link with Discord' }))
    expect(linkDiscord).toHaveBeenCalledWith('mt')
    expect(onSignedIn).toHaveBeenCalledWith(USER, false)
  })
})
