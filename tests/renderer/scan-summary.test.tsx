import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { isToScanWindow } from '@shared/scanWindow'
import { listValue } from '@/features/scan/scanLook'
import type { ScanRow } from '@/features/scan/session'
import { launch } from '@/features/scan/window/confettiPieces'
import { sessionSummary } from '@/features/scan/window/summary'
import { PAGE_MS, PAGE_ROWS, SummaryScreen } from '@/features/scan/window/SummaryScreen'
import { createMockApi, renderWithProviders } from './mockApi'

let id = 0
const row = (price: number | null, over: Partial<ScanRow> = {}): ScanRow => {
  id++
  return {
    key: `k${id}`,
    cardId: id,
    name: `Card ${id}`,
    imageId: id,
    printingId: id,
    setCode: 'X',
    rarity: 'R',
    flag: null,
    via: 'code',
    quantity: 1,
    addedAt: 0,
    options: [{ printingId: id, cardId: id, price } as ScanRow['options'][number]],
    ...over
  } as ScanRow
}

describe('sessionSummary', () => {
  it('agrees with the Review list on value and unpriced copies', () => {
    const rows = [row(10, { quantity: 3 }), row(null, { quantity: 2 }), row(1.5)]
    const s = sessionSummary(rows, 20)
    expect(s).toMatchObject({ value: listValue(rows).value, unpriced: 2, cards: 6 })
    expect(s.value).toBe(31.5)
  })

  it('counts hit copies, but never a best guess', () => {
    const s = sessionSummary([row(25, { quantity: 2 }), row(90, { guess: true }), row(19.99)], 20)
    expect(s.hits).toBe(2)
  })

  it('leaves a version still to pick out of the value and the hit, as the list does', () => {
    const open = row(500, { game: 'pkm', flag: 'pick-printing' })
    const s = sessionSummary([open, row(5)], 20)
    expect(s).toMatchObject({ value: 5, unpriced: 1 })
    expect(s.hit?.price).toBe(5)
  })

  it('lists every row dearest first, no price last', () => {
    const rows = [row(null), row(3), row(50, { guess: true, slab: true }), row(9, { quantity: 2 })]
    const s = sessionSummary(rows, 20)
    expect(s.list.map((c) => c.price)).toEqual([50, 9, 3, null])
    expect(s.list[0]).toMatchObject({ guess: true, raw: true, detail: 'X · R' })
    expect(s.list[1]).toMatchObject({ quantity: 2, guess: false, raw: false })
  })

  it('the hit of the night is the dearest known card, never a best guess', () => {
    const s = sessionSummary([row(90, { guess: true }), row(12), row(4)], 20)
    expect(s.hit?.price).toBe(12)
    expect(sessionSummary([row(90, { guess: true })], 20).hit).toBeNull()
  })
})

describe('SummaryScreen', () => {
  afterEach(() => vi.useRealTimers())

  it('shows the numbers, and says when a card has no price', () => {
    window.api = createMockApi() as typeof window.api
    renderWithProviders(<SummaryScreen summary={sessionSummary([row(25), row(null)], 20)} />)
    const s = screen.getByRole('status', { name: 'Summary' })
    expect(s).toHaveTextContent('$25.00')
    expect(s).toHaveTextContent('2cards')
    expect(s).toHaveTextContent('1hit')
    expect(s).toHaveTextContent('1 card with no price')
  })

  it('shows the hit and prices each row for all its copies', () => {
    window.api = createMockApi() as typeof window.api
    const rows = [row(25, { name: 'Pikachu' }), row(2, { name: 'Bulbasaur', quantity: 3 })]
    renderWithProviders(<SummaryScreen summary={sessionSummary(rows, 20)} />)
    expect(screen.getByRole('region', { name: 'Hit of the night' })).toHaveTextContent('Pikachu')
    const list = within(screen.getByRole('region', { name: 'Every card' }))
    expect(list.getByText('×3')).toBeInTheDocument()
    expect(list.getByText('$6.00')).toBeInTheDocument()
  })

  it('a row with no price says so instead of $0, and no known card means no hit', () => {
    window.api = createMockApi() as typeof window.api
    renderWithProviders(<SummaryScreen summary={sessionSummary([row(null)], 20)} />)
    expect(screen.getByText('No price')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Hit of the night' })).not.toBeInTheDocument()
  })

  it('a long list turns its own pages and comes back round', () => {
    vi.useFakeTimers()
    window.api = createMockApi() as typeof window.api
    const rows = Array.from({ length: PAGE_ROWS + 1 }, (_, i) => row(100 - i))
    renderWithProviders(<SummaryScreen summary={sessionSummary(rows, 20)} />)
    const shown = (): number =>
      within(screen.getByRole('region', { name: 'Every card' })).getAllByRole('listitem').length
    expect(shown()).toBe(PAGE_ROWS)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(PAGE_MS))
    expect(shown()).toBe(1)
    act(() => vi.advanceTimersByTime(PAGE_MS))
    expect(shown()).toBe(PAGE_ROWS)
  })

  it('an empty list says so instead of $0', () => {
    render(<SummaryScreen summary={sessionSummary([], 20)} />)
    expect(screen.getByText('No cards yet')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })
})

it('confetti fires up and inwards from both sides, evenly', () => {
  const pieces = launch(1280, 720, () => 0.5)
  const left = pieces.filter((p) => p.x === 0)
  const right = pieces.filter((p) => p.x === 1280)
  expect(left.length).toBeGreaterThan(0)
  expect(right).toHaveLength(left.length)
  expect(left.every((p) => p.vx > 0 && p.vy < 0)).toBe(true)
  expect(right.every((p) => p.vx < 0 && p.vy < 0)).toBe(true)
})

it('main relays the summary message', () => {
  expect(isToScanWindow({ kind: 'summary', summary: null })).toBe(true)
})
