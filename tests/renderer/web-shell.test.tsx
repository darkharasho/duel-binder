import { screen } from '@testing-library/react'
import App from '@/App'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { createMockApi, renderWithProviders } from './mockApi'

const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }

const stubMe = (body: unknown, status = 200): void => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.api = undefined as never
})

describe('web build', () => {
  it('web shell has no window controls', () => {
    stubMe(seto)
    renderWithProviders(<App />, { api: createMockApi({ window: { platform: 'web' } }) })
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Minimize' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('web settings shows the account and sign-out', async () => {
    stubMe(seto)
    renderWithProviders(<SettingsPage />, { api: createMockApi({ window: { platform: 'web' } }) })
    expect(await screen.findByText('Signed in as Seto')).toBeInTheDocument()
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    const form = signOut.closest('form')
    expect(form).toHaveAttribute('action', '/auth/logout')
    expect(form).toHaveAttribute('method', 'post')
    for (const name of ['Check for updates', 'Clear image cache', 'Refresh card data', 'Open data folder']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('web settings offers sign-in when signed out', async () => {
    stubMe({ error: 'unauthorized' }, 401)
    renderWithProviders(<SettingsPage />, { api: createMockApi({ window: { platform: 'web' } }) })
    expect(await screen.findByText('Not signed in')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/')
  })

  it('web settings reports an account load failure', async () => {
    stubMe({}, 500)
    renderWithProviders(<SettingsPage />, { api: createMockApi({ window: { platform: 'web' } }) })
    expect(await screen.findByText("Couldn't load your account")).toBeInTheDocument()
  })

  it('desktop settings has no account section', async () => {
    stubMe(seto)
    renderWithProviders(<SettingsPage />, { api: createMockApi({ window: { platform: 'linux' } }) })
    expect(await screen.findByRole('button', { name: 'Check for updates' })).toBeInTheDocument()
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})
