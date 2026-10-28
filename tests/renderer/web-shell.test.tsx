import { fireEvent, screen } from '@testing-library/react'
import App from '@/App'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { createMockApi, renderWithProviders } from './mockApi'

const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }

const stubMe = (body: unknown, status = 200): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  )
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

  it('shows the Admin link only to the admin account', async () => {
    stubMe({ ...seto, admin: true })
    const { unmount } = renderWithProviders(<App />, {
      api: createMockApi({ window: { platform: 'web' } })
    })
    expect(await screen.findByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
    unmount()

    stubMe(seto)
    renderWithProviders(<App />, { api: createMockApi({ window: { platform: 'web' } }) })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/me', expect.anything()))
    await screen.findByRole('button', { name: 'Dashboard' })
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
  })

  it('web settings shows the account and sign-out', async () => {
    stubMe(seto)
    renderWithProviders(<SettingsPage />, { api: createMockApi({ window: { platform: 'web' } }) })
    expect(await screen.findByText('Signed in as Seto')).toBeInTheDocument()
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    const form = signOut.closest('form')
    expect(form).toHaveAttribute('action', '/auth/logout')
    expect(form).toHaveAttribute('method', 'post')
    for (const name of [
      'Check for updates',
      'Clear image cache',
      'Refresh card data',
      'Open data folder'
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('hides an avatar that fails to load', async () => {
    stubMe({ ...seto, avatarUrl: 'https://cdn.discordapp.com/a.png' })
    const { container } = renderWithProviders(<SettingsPage />, {
      api: createMockApi({ window: { platform: 'web' } })
    })
    await screen.findByText('Signed in as Seto')
    const img = container.querySelector('img')!
    expect(img).toBeInTheDocument()
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
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

  it('desktop settings shows the account section', async () => {
    stubMe(seto)
    renderWithProviders(<SettingsPage />, { api: createMockApi({ window: { platform: 'linux' } }) })
    expect(await screen.findByRole('button', { name: 'Check for updates' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})
