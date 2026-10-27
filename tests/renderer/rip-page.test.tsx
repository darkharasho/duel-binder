import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { RipPage } from '@/features/rip/RipPage'
import { clampPackCount } from '@/features/rip/SetPicker'
import type { RipCard, RipSet } from '../../src/shared/rip/types'
import { createMockApi, renderWithProviders } from './mockApi'

const ripSet = (setName: string, setCode: string): RipSet => ({
  setName,
  setCode,
  tcgDate: '2002-03-08',
  imageKey: null,
  packImageKey: null,
  logoImageKey: null,
  coverImageId: null,
  layoutLabel: 'Core Booster (2002–2004)',
  packLine: '9 cards a pack · 1 Rare or better'
})

const SETS = [ripSet('Metal Raiders', 'MRD'), ripSet('Legend of Blue Eyes', 'LOB')]

describe('clampPackCount', () => {
  it('rounds and clamps to 1-100, non-finite to 1', () => {
    expect(clampPackCount(0)).toBe(1)
    expect(clampPackCount(101)).toBe(100)
    expect(clampPackCount(2.5)).toBe(3)
    expect(clampPackCount(NaN)).toBe(1)
    expect(clampPackCount(Infinity)).toBe(1)
  })
})

describe('RipPage', () => {
  it('shows the empty state when no sets can be ripped', async () => {
    renderWithProviders(<RipPage />, {
      api: createMockApi({ rip: { sets: vi.fn(async () => []) } })
    })
    expect(await screen.findByText(/no sets to rip/i)).toBeInTheDocument()
  })

  it('shows an error when the sets fail to load', async () => {
    const sets = vi.fn(async () => {
      throw new Error('boom')
    })
    renderWithProviders(<RipPage />, { api: createMockApi({ rip: { sets } }) })
    expect(await screen.findByText(/couldn.t load sets/i)).toBeInTheDocument()
  })

  it('describes the pack from its slots, with the era as a tooltip', async () => {
    renderWithProviders(<RipPage />, {
      api: createMockApi({ rip: { sets: vi.fn(async () => SETS) } })
    })
    await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
    const line = screen.getByText('9 cards a pack · 1 Rare or better')
    expect(line).toHaveAttribute('title', 'Core Booster (2002–2004)')
  })

  it('typing 500 shows 100, and the stepper holds at the bounds', async () => {
    renderWithProviders(<RipPage />, {
      api: createMockApi({ rip: { sets: vi.fn(async () => SETS) } })
    })
    await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
    const input = screen.getByRole('spinbutton', { name: /packs/i })
    await userEvent.clear(input)
    await userEvent.type(input, '500')
    await userEvent.tab()
    expect(input).toHaveValue(100)
    await userEvent.click(screen.getByRole('button', { name: /more packs/i }))
    expect(input).toHaveValue(100)
  })

  it('filters sets by name or code', async () => {
    renderWithProviders(<RipPage />, {
      api: createMockApi({ rip: { sets: vi.fn(async () => SETS) } })
    })
    await screen.findByRole('button', { name: /Metal Raiders/ })
    await userEvent.type(screen.getByRole('searchbox'), 'lob')
    expect(screen.queryByRole('button', { name: /Metal Raiders/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Legend of Blue Eyes/ })).toBeInTheDocument()
  })

  it('picking a set and 5 packs starts a session and shows the opener', async () => {
    const start = vi.fn(async () => 9)
    const api = createMockApi({
      rip: { sets: vi.fn(async () => SETS), start, openPack: vi.fn(async () => []) }
    })
    renderWithProviders(<RipPage />, { api })
    await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
    await userEvent.click(screen.getByRole('button', { name: '5' }))
    await userEvent.click(screen.getByRole('button', { name: /rip 5 packs/i }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('Metal Raiders', 5))
    expect(await screen.findByText(/pack 1 of 5/i)).toBeInTheDocument()
  })

  it('ignores a second click while start is in flight', async () => {
    let reject!: (e: Error) => void
    const start = vi.fn(() => new Promise<number>((_, r) => (reject = r)))
    renderWithProviders(<RipPage />, {
      api: createMockApi({ rip: { sets: vi.fn(async () => SETS), start } })
    })
    await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
    await userEvent.dblClick(screen.getByRole('button', { name: /rip 1 pack/i }))
    expect(start).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /rip 1 pack/i })).toBeDisabled()
    await act(async () => reject(new Error('nope')))
    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
    expect(screen.getByRole('button', { name: /rip 1 pack/i })).toBeEnabled()
  })

  describe('with an opening in progress', () => {
    // Reduced motion: the opener's tear and card moves happen at once.
    beforeEach(() => {
      const real = window.matchMedia
      vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
        ...real(q),
        matches: q.includes('reduce')
      }))
    })
    afterEach(() => vi.restoreAllMocks())

    const card = (slot: number): RipCard => ({
      pkey: `k${slot}`,
      cardId: slot,
      name: `Card ${slot}`,
      setCode: `MRD-EN00${slot}`,
      rarity: 'Common',
      variant: null,
      frameType: 'normal',
      imageId: slot,
      slot
    })
    const startOpening = async (packCount: number): Promise<ReturnType<typeof vi.fn>> => {
      const openPack = vi.fn(async () => [card(0), card(1)])
      renderWithProviders(<RipPage />, {
        api: createMockApi({
          rip: {
            sets: vi.fn(async () => SETS),
            start: vi.fn(async () => 9),
            openPack,
            session: vi.fn(async () => ({
              id: 9,
              setName: 'Metal Raiders',
              setCode: 'MRD',
              packCount: 1,
              packsOpened: 1,
              startedAt: '2026-10-20T15:00:00.000Z',
              best: null,
              packs: [[card(0), card(1)]]
            }))
          }
        })
      })
      await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
      await userEvent.click(screen.getByRole('button', { name: packCount === 5 ? '5' : '1' }))
      await userEvent.click(screen.getByRole('button', { name: /rip \d+ packs?/i }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /skip to the hit/i })).toBeEnabled()
      )
      return openPack
    }

    const startOpeningWithSummary = async (): Promise<{
      api: ReturnType<typeof createMockApi>
    }> => {
      const api = createMockApi({
        rip: {
          sets: vi.fn(async () => SETS),
          start: vi.fn(async () => 9),
          openPack: vi.fn(async () => [card(0), card(1)]),
          session: vi.fn(async () => ({
            id: 9,
            setName: 'Metal Raiders',
            setCode: 'MRD',
            packCount: 1,
            packsOpened: 1,
            startedAt: '2026-10-20T15:00:00.000Z',
            best: null,
            packs: [[card(0), card(1)]]
          }))
        }
      })
      renderWithProviders(<RipPage />, { api })
      await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
      await userEvent.click(screen.getByRole('button', { name: /rip 1 pack/i }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /skip to the hit/i })).toBeEnabled()
      )
      await userEvent.click(screen.getByRole('button', { name: /skip to the hit/i }))
      await userEvent.click(screen.getByRole('button', { name: /finish|next pack/i }))
      await screen.findByText('1 pack of Metal Raiders')
      return { api }
    }

    it('shows the picked set on the sealed pack', async () => {
      const api = createMockApi({
        rip: {
          sets: vi.fn(async () => [{ ...SETS[0], packImageKey: 'MRD-pack.png' }]),
          start: vi.fn(async () => 9),
          openPack: vi.fn(async () => [card(0), card(1)])
        }
      })
      renderWithProviders(<RipPage />, { api })
      await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
      await userEvent.click(screen.getByRole('button', { name: /rip \d+ packs?/i }))
      const pack = await screen.findByTestId('rip-pack')
      expect(pack.querySelector(`[data-testid="rip-pack-image"]`)).toHaveAttribute(
        'src',
        'ygo-img://set/MRD-pack.png'
      )
    })

    it('keeps its place across a trip to History', async () => {
      const openPack = await startOpening(5)
      await userEvent.click(screen.getByRole('button', { name: /skip to the hit/i }))
      await userEvent.click(screen.getByRole('button', { name: /next pack/i }))
      await waitFor(() => expect(screen.getByText(/pack 2 of 5/i)).toBeInTheDocument())
      expect(openPack).toHaveBeenCalledTimes(2)
      await userEvent.click(screen.getByRole('radio', { name: 'History' }))
      expect(await screen.findByText(/nothing ripped yet/i)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('radio', { name: 'Open packs' }))
      expect(screen.getByText(/pack 2 of 5/i)).toBeInTheDocument()
      expect(openPack).toHaveBeenCalledTimes(2)
    })

    it('ignores Space while History shows', async () => {
      await startOpening(5)
      await userEvent.click(screen.getByRole('radio', { name: 'History' }))
      fireEvent.keyDown(window, { key: ' ', code: 'Space' })
      await userEvent.click(screen.getByRole('radio', { name: 'Open packs' }))
      expect(screen.queryByRole('img', { name: 'Card 0' })).not.toBeInTheDocument()
    })

    it('shows the summary when done, and Pick another set returns to the picker with the set selected', async () => {
      await startOpening(1)
      await userEvent.click(screen.getByRole('button', { name: /skip to the hit/i }))
      await userEvent.click(screen.getByRole('button', { name: /finish|next pack/i }))
      expect(await screen.findByText('1 pack of Metal Raiders')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /pick another set/i }))
      const tile = await screen.findByRole('button', { name: /Metal Raiders/ })
      expect(tile).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: /rip \d+ packs?/i })).toBeInTheDocument()
    })

    it('Rip more starts the same set and count again', async () => {
      const { api } = await startOpeningWithSummary()
      await userEvent.click(screen.getByRole('button', { name: /rip 1 more/i }))
      await waitFor(() => expect(api.rip.start).toHaveBeenCalledTimes(2))
      expect(api.rip.start).toHaveBeenLastCalledWith('Metal Raiders', 1)
      expect(await screen.findByText(/pack 1 of 1/i)).toBeInTheDocument()
    })
  })
})
