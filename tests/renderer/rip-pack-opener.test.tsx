import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import { PackOpener } from '@/features/rip/PackOpener'
import type { Api } from '@shared/ipc'
import type { RipCard } from '../../src/shared/rip/types'
import { createMockApi, renderWithProviders } from './mockApi'

const card = (rarity: string, slot: number, name = `Card ${slot}`): RipCard => ({
  pkey: `k${slot}`,
  cardId: slot,
  name,
  setCode: `LOB-EN00${slot}`,
  rarity,
  variant: null,
  frameType: 'normal',
  imageId: slot,
  slot
})

const commons = (): RipCard[] => [card('Common', 0), card('Common', 1), card('Common', 2)]

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const space = (target: Window | Element = window): void => {
  fireEvent.keyDown(target, { key: ' ', code: 'Space' })
}

function renderOpener(
  openPack: (id: number) => Promise<RipCard[]>,
  { packCount = 3, onDone = vi.fn(), strict = false } = {}
): { api: Api; unmount: () => void; onDone: typeof onDone } {
  const ui = (
    <PackOpener sessionId={7} packCount={packCount} setName="Legend of Blue Eyes" onDone={onDone} />
  )
  const api = createMockApi({ rip: { openPack: vi.fn(openPack) } })
  if (strict) {
    // StrictMode at the root: React only double-runs mount effects for a root-level StrictMode.
    window.api = api
    return {
      api,
      unmount: render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>, {
        reactStrictMode: true
      }).unmount,
      onDone
    }
  }
  return { ...renderWithProviders(ui, { api }), onDone }
}

const skipButton = (): HTMLElement => screen.getByRole('button', { name: /skip pack/i })
const loadedPack = async (): Promise<void> => {
  await waitFor(() => expect(skipButton()).toBeEnabled())
}

describe('PackOpener', () => {
  it('after a pack refreshes History and sessions, not the sets list, and preloads the art', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const srcs: string[] = []
    const RealImage = window.Image
    vi.stubGlobal(
      'Image',
      class {
        set src(v: string) {
          srcs.push(v)
        }
      }
    )
    try {
      renderOpener(async () => commons())
      await loadedPack()
      const keys = spy.mock.calls.map(([f]) => f?.queryKey)
      expect(keys).toEqual([
        ['rip', 'history'],
        ['rip', 'session']
      ])
      expect(srcs).toEqual(['ygo-img://full/0', 'ygo-img://full/1', 'ygo-img://full/2'])
    } finally {
      vi.stubGlobal('Image', RealImage)
      spy.mockRestore()
    }
  })

  it('opens the first pack once under StrictMode', async () => {
    const { api } = renderOpener(async () => commons(), { strict: true })
    await loadedPack()
    expect(api.rip.openPack).toHaveBeenCalledTimes(1)
    expect(api.rip.openPack).toHaveBeenCalledWith(7)
    expect(screen.getByText(/pack 1 of 3/i)).toBeInTheDocument()
  })

  it('next pack only once while loading', async () => {
    const second = deferred<RipCard[]>()
    const calls = [Promise.resolve(commons()), second.promise]
    const { api } = renderOpener(() => calls.shift() ?? new Promise(() => {}))
    await loadedPack()
    fireEvent.click(skipButton())
    for (let i = 0; i < 5; i++) space()
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    await act(async () => second.resolve(commons()))
    await loadedPack()
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument()
  })

  it('Space flips one card at a time, then moves to the next pack', async () => {
    const { api } = renderOpener(async () => commons())
    await loadedPack()
    space()
    expect(screen.getAllByRole('img', { name: 'Card 0' })).toHaveLength(1)
    expect(screen.queryByRole('img', { name: 'Card 1' })).not.toBeInTheDocument()
    space()
    space()
    expect(screen.getByRole('img', { name: 'Card 2' })).toBeInTheDocument()
    expect(api.rip.openPack).toHaveBeenCalledTimes(1)
    space()
    await waitFor(() => expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument())
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    await loadedPack()
  })

  it('Space on a focused button is left to the button', async () => {
    renderOpener(async () => commons())
    await loadedPack()
    space(skipButton())
    expect(screen.queryByRole('img', { name: 'Card 0' })).not.toBeInTheDocument()
  })

  it('Space on a disabled button still flips and moves on', async () => {
    const { api } = renderOpener(async () => commons())
    await loadedPack()
    fireEvent.click(skipButton())
    expect(skipButton()).toBeDisabled()
    space(skipButton())
    await waitFor(() => expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument())
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    await loadedPack()
    const next = screen.getByRole('button', { name: /next pack/i })
    expect(next).toBeDisabled()
    space(next)
    expect(screen.getByRole('img', { name: 'Card 0' })).toBeInTheDocument()
  })

  it('a hit comes up large with its rarity and the best pull so far', async () => {
    renderOpener(async () => [card('Secret Rare', 0, 'Dark Magician'), card('Common', 1)])
    await loadedPack()
    fireEvent.click(skipButton())
    const featured = screen.getByTestId('rip-featured')
    expect(featured).toHaveTextContent('Dark Magician')
    expect(featured).toHaveTextContent('Secret Rare')
    expect(featured.querySelector('[data-holo]')).not.toBeNull()
    expect(screen.getByTestId('rip-best')).toHaveTextContent('Secret Rare')
    expect(document.body.textContent).not.toMatch(/\$\d/)
  })

  it('commons drop into the top row', async () => {
    renderOpener(async () => commons())
    await loadedPack()
    fireEvent.click(skipButton())
    expect(screen.getByTestId('rip-row').querySelectorAll('img')).toHaveLength(3)
    expect(screen.queryByTestId('rip-featured')).not.toBeInTheDocument()
  })

  it('reports the opened packs when the last pack is done', async () => {
    const { onDone } = renderOpener(async () => commons(), { packCount: 1 })
    await loadedPack()
    fireEvent.click(skipButton())
    fireEvent.click(screen.getByRole('button', { name: /finish|next pack/i }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(onDone.mock.calls[0][0]).toHaveLength(1)
    expect(onDone.mock.calls[0][0][0]).toHaveLength(3)
  })

  it('shows a retry when opening a pack fails', async () => {
    const calls = [Promise.reject(new Error('boom')), Promise.resolve(commons())]
    const { api } = renderOpener(() => calls.shift()!)
    const retry = await screen.findByRole('button', { name: /try again/i })
    fireEvent.click(retry)
    await loadedPack()
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
  })

  it('unmount mid-session keeps opened packs', async () => {
    const error = vi.spyOn(console, 'error')
    const second = deferred<RipCard[]>()
    const calls = [Promise.resolve(commons()), second.promise]
    const { api, unmount } = renderOpener(() => calls.shift() ?? Promise.resolve(commons()))
    await loadedPack()
    fireEvent.click(skipButton())
    space()
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    unmount()
    await act(async () => second.resolve(commons()))
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
