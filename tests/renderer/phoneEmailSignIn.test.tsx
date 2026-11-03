import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const build = vi.hoisted(() => ({ platform: 'android' as 'web' | 'ios' | 'android' }))
vi.mock('@/web/account', () => ({ fetchMe: async () => null }))
vi.mock('@/lib/portal', () => ({
  get APP_PLATFORM() {
    return build.platform
  },
  PORTAL_ORIGIN: 'https://portal.test',
  isNativeApp: () => true
}))
vi.mock('../../src/phone/nativeSignIn', async (orig) => ({
  ...(await orig<typeof import('../../src/phone/nativeSignIn')>()),
  nativeSignIn: vi.fn(),
  appleSignIn: vi.fn()
}))

import { claimEmailClient, phoneEmailClient } from '../../src/phone/emailAuth'
import { SignIn } from '../../src/phone/SignIn'
import { nativeSignIn } from '../../src/phone/nativeSignIn'

const USER = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }

function portal(
  status: boolean | 'error',
  steps: Record<string, unknown> = {}
): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/email/status')) {
      if (status === 'error') throw new Error('offline')
      return new Response(JSON.stringify({ enabled: status }))
    }
    const reply = steps[url.split('/auth/email/')[1]]
    return reply
      ? new Response(JSON.stringify(reply))
      : new Response(JSON.stringify({ error: 'nope' }), { status: 400 })
  })
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(nativeSignIn).mockReset()
})

describe('phoneEmailClient', () => {
  it('stores the token and hides it from the view', async () => {
    const store = { signIn: vi.fn(async () => {}) }
    const f = portal(true, {
      confirm: { next: 'signed-in', token: 'secret', user: USER, created: true }
    })
    const view = await phoneEmailClient(store, f as never).step('confirm', {
      ticket: 't',
      code: '1'
    })
    expect(store.signIn).toHaveBeenCalledWith('secret', USER)
    expect(view).toEqual({ next: 'signed-in', user: USER, created: true })
    expect('token' in view).toBe(false)
  })

  it("rejects with the portal's copy", async () => {
    const f = portal(true, {})
    f.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "That code doesn't match." }), { status: 400 })
    )
    await expect(
      phoneEmailClient({ signIn: vi.fn() }, f as never).step('confirm', {})
    ).rejects.toThrow("That code doesn't match.")
  })

  it('a reply that is not JSON, or has no next, rejects with generic copy', async () => {
    for (const body of ['<html>oops</html>', '{"hello":1}']) {
      const f = vi.fn(async () => new Response(body))
      await expect(
        phoneEmailClient({ signIn: vi.fn() }, f as never).step('check', {})
      ).rejects.toThrow("Sign-in didn't go through. Try again.")
    }
  })

  it('links Discord through the sheet, sending the code and verifier with the ticket', async () => {
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    const f = portal(true, {
      'link-discord': { next: 'signed-in', token: 't', user: USER, created: false }
    })
    const client = phoneEmailClient({ signIn: vi.fn(async () => {}) }, f as never)
    await client.linkDiscord!('tk')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ ticket: 'tk', code: 'c', verifier: 'v' })
    expect(client.linkApple).toBeUndefined()
  })

  it('claim steps carry the claim ticket and verifier', async () => {
    const step = vi.fn(async () => ({ next: 'signed-in', user: USER, created: false }) as never)
    const client = claimEmailClient({ step }, { claim: 'cl', verifier: 'v' })
    await client.step('claim', { password: 'pw' })
    expect(step).toHaveBeenCalledWith('claim', { password: 'pw', ticket: 'cl', verifier: 'v' })
    await client.step('forgot', { email: 'a@b.co' })
    expect(step).toHaveBeenLastCalledWith('forgot', { email: 'a@b.co' })
  })
})

describe('phone SignIn, native', () => {
  it('android shows Discord then email when enabled', async () => {
    build.platform = 'android'
    portal(true)
    render(<SignIn store={{} as never} onSignedIn={() => {}} />)
    const email = await screen.findByRole('button', { name: 'Continue with email' })
    const discord = screen.getByRole('button', { name: 'Sign in with Discord' })
    expect(discord.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign in with Apple' })).toBeNull()
  })

  it('ios puts email after Apple and Discord', async () => {
    build.platform = 'ios'
    portal(true)
    render(<SignIn store={{} as never} onSignedIn={() => {}} />)
    const names = (await screen.findByRole('button', { name: 'Continue with email' }))
      .parentElement!
    expect([...names.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Sign in with Apple',
      'Sign in with Discord',
      'Continue with email'
    ])
  })

  it('hides email when status fails', async () => {
    build.platform = 'android'
    const f = portal('error')
    render(<SignIn store={{} as never} onSignedIn={() => {}} />)
    await screen.findByRole('button', { name: 'Sign in with Discord' })
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Continue with email' })).toBeNull()
  })

  it('a Discord claim shows the password screen and links with the verifier', async () => {
    build.platform = 'android'
    const user = userEvent.setup()
    const onSignedIn = vi.fn()
    const f = portal(true, {
      claim: { next: 'signed-in', token: 'tok', user: USER, created: false }
    })
    vi.mocked(nativeSignIn).mockResolvedValue({
      claim: 'cl',
      email: 'a@b.co',
      verifier: 'v'
    } as never)
    const store = { signIn: vi.fn(async () => {}) }
    render(<SignIn store={store as never} onSignedIn={onSignedIn} />)
    await user.click(await screen.findByRole('button', { name: 'Sign in with Discord' }))
    await user.type(await screen.findByLabelText('Password'), 'hunter22!')
    await user.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(USER))
    const call = f.mock.calls.find((c) => String(c[0]).endsWith('/auth/email/claim'))!
    expect(JSON.parse(call[1].body)).toEqual({ password: 'hunter22!', ticket: 'cl', verifier: 'v' })
    expect(store.signIn).toHaveBeenCalledWith('tok', USER)
  })
})
