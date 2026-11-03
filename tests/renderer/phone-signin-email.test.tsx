import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/web/account', () => ({ fetchMe: async () => null }))
vi.mock('@/lib/portal', () => ({ APP_PLATFORM: 'web', isNativeApp: () => false }))

import { SignIn } from '../../src/phone/SignIn'

const store = {} as never

function status(enabled: boolean | 'error'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/auth/email/status') {
        if (enabled === 'error') throw new Error('offline')
        return new Response(JSON.stringify({ enabled }))
      }
      return new Response('{}', { status: 401 })
    })
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('phone web sign-in email link', () => {
  it('shows the email link when enabled', async () => {
    status(true)
    render(<SignIn store={store} onSignedIn={() => {}} />)
    const link = await screen.findByRole('link', { name: 'Continue with email' })
    expect(link.getAttribute('href')).toBe('/auth/email?next=scan')
  })

  it('hides it when disabled or when the status check fails', async () => {
    for (const s of [false, 'error'] as const) {
      status(s)
      const { unmount } = render(<SignIn store={store} onSignedIn={() => {}} />)
      await screen.findByRole('link', { name: 'Sign in with Discord' })
      await waitFor(() => expect(fetch).toHaveBeenCalledWith('/auth/email/status'))
      expect(screen.queryByText('Continue with email')).toBeNull()
      unmount()
    }
  })
})
