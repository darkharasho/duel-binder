import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { RipPage } from '@/features/rip/RipPage'
import { clampPackCount } from '@/features/rip/SetPicker'
import type { RipSet } from '../../src/shared/rip/types'
import { createMockApi, renderWithProviders } from './mockApi'

const ripSet = (setName: string, setCode: string): RipSet => ({
  setName,
  setCode,
  tcgDate: '2002-03-08',
  imageKey: null,
  packImageKey: null,
  logoImageKey: null,
  coverImageId: null,
  layoutLabel: '9 cards: 8 Common, 1 Rare'
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
})
