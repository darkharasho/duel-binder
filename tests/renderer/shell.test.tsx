import { fireEvent, screen, waitFor } from '@testing-library/react'
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
    const { container } = renderWithProviders(<App />)
    const flag = (): string | null => container.ownerDocument.querySelector('[data-add-open]')!.getAttribute('data-add-open')
    expect(flag()).toBe('false')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(flag()).toBe('true')
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

  it('shows the error text', async () => {
    const api = createMockApi({ sync: { status: async () => status({ state: 'error', error: 'HTTP 500' }) } })
    renderWithProviders(<App />, { api })
    expect(await screen.findByText("Couldn't update card data: HTTP 500")).toBeInTheDocument()
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
