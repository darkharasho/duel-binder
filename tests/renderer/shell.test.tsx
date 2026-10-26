import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { CardArt } from '@/components/CardArt'
import { createMockApi, renderWithProviders } from './mockApi'

const status = (o: object = {}) => ({
  state: 'idle' as const,
  lastSyncAt: null,
  dbVersion: null,
  cardCount: 100,
  error: null,
  blocked: null,
  ...o
})

describe('AppShell', () => {
  it('navigation switches pages', async () => {
    renderWithProviders(<App />)
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collection' }))
    expect(screen.getByRole('heading', { name: 'Collection' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  })

  it('Ctrl+K and the Add card button open the add flow', async () => {
    renderWithProviders(<App />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByPlaceholderText(/Search cards/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Add card/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('AppShell sets nav', () => {
  it('lists Sets between Collection and Settings and opens it', async () => {
    renderWithProviders(<App />)
    const names = within(screen.getByRole('navigation', { name: 'Main' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(names).toEqual(['Dashboard', 'Collection', 'Sets', 'Browse', 'Scan', 'Settings'])
    await userEvent.click(screen.getByRole('button', { name: 'Sets' }))
    expect(screen.getByRole('heading', { name: 'Sets' })).toBeInTheDocument()
  })
})

describe('data changed', () => {
  it('refetches the sets queries when main reports changed data', async () => {
    let fire: () => void = () => {}
    const api = createMockApi({ app: { onDataChanged: vi.fn((cb) => ((fire = cb), () => {})) } })
    renderWithProviders(<App />, { api })
    await userEvent.click(screen.getByRole('button', { name: 'Sets' }))
    await waitFor(() => expect(api.sets.list).toHaveBeenCalled())
    const before = vi.mocked(api.sets.list).mock.calls.length
    act(() => fire())
    await waitFor(() => expect(vi.mocked(api.sets.list).mock.calls.length).toBeGreaterThan(before))
  })

  it('also invalidates card detail queries', async () => {
    let fire: () => void = () => {}
    const api = createMockApi({ app: { onDataChanged: vi.fn((cb) => ((fire = cb), () => {})) } })
    const { client } = renderWithProviders(<App />, { api })
    await waitFor(() => expect(api.app.onDataChanged).toHaveBeenCalled())
    const spy = vi.spyOn(client, 'invalidateQueries')
    act(() => fire())
    expect(spy).toHaveBeenCalledWith({ queryKey: ['card'] })
  })
})

describe('SyncBanner', () => {
  it('shows the first-run message and Retry runs a sync', async () => {
    const run = vi.fn(async () => status({ cardCount: 5 }))
    const api = createMockApi({ sync: { status: async () => status({ cardCount: 0 }), run } })
    renderWithProviders(<App />, { api })
    expect(await screen.findByText(/No card data yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(run).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText(/No card data yet/)).not.toBeInTheDocument())
  })

  it('says offline with saved data when a sync failed but cards exist', async () => {
    const api = createMockApi({
      sync: { status: async () => status({ state: 'error', error: 'HTTP 500', cardCount: 5, lastSyncAt: new Date().toISOString() }) }
    })
    renderWithProviders(<App />, { api })
    expect(
      await screen.findByText('Offline — using saved card data (prices updated just now)')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('asks to connect when the first sync failed with no cards', async () => {
    const api = createMockApi({ sync: { status: async () => status({ state: 'error', error: 'HTTP 500', cardCount: 0 }) } })
    renderWithProviders(<App />, { api })
    expect(await screen.findByText(/Connect to the internet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows progress while downloading', async () => {
    const api = createMockApi({ sync: { status: async () => status({ state: 'downloading', cardCount: 0 }) } })
    renderWithProviders(<App />, { api })
    expect(await screen.findByText('Downloading card database…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})

describe('CardArt', () => {
  it('loads from ygo-img and swaps to a placeholder on error', () => {
    const { container } = renderWithProviders(<CardArt imageId={123} size="small" alt="Dark Magician" />)
    const img = screen.getByAltText('Dark Magician')
    expect(img).toHaveAttribute('src', 'ygo-img://small/123')
    expect(img).toHaveAttribute('loading', 'lazy')
    fireEvent.error(img)
    expect(screen.queryByAltText('Dark Magician')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="card-art-placeholder"]')).not.toBeNull()
  })
})
