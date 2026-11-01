import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isToScanWindow } from '@shared/scanWindow'
import { listValue } from '@/features/scan/scanLook'
import type { ScanRow } from '@/features/scan/session'
import { sessionSummary } from '@/features/scan/window/summary'
import { SummaryScreen } from '@/features/scan/window/SummaryScreen'
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

  it('leaves a version still to pick out of the value and the top, as the list does', () => {
    const open = row(500, { game: 'pkm', flag: 'pick-printing' })
    const s = sessionSummary([open, row(5)], 20)
    expect(s).toMatchObject({ value: 5, unpriced: 1 })
    expect(s.top.map((t) => t.price)).toEqual([5])
  })

  it('lists the five dearest, dearest first, and marks guesses and slabs', () => {
    const prices = [3, 9, 1, 7, 5, 8]
    const s = sessionSummary(
      [...prices.map((p) => row(p)), row(50, { guess: true, slab: true })],
      20
    )
    expect(s.top.map((t) => t.price)).toEqual([50, 9, 8, 7, 5])
    expect(s.top[0]).toMatchObject({ guess: true, raw: true })
    expect(s.top[1]).toMatchObject({ guess: false, raw: false })
  })
})

describe('SummaryScreen', () => {
  it('shows the numbers, and says when a card has no price', () => {
    window.api = createMockApi() as typeof window.api
    renderWithProviders(<SummaryScreen summary={sessionSummary([row(25), row(null)], 20)} />)
    const s = screen.getByRole('status', { name: 'Summary' })
    expect(s).toHaveTextContent('$25.00')
    expect(s).toHaveTextContent('2cards')
    expect(s).toHaveTextContent('1hit')
    expect(s).toHaveTextContent('1 card with no price')
  })

  it('an empty list says so instead of $0', () => {
    render(<SummaryScreen summary={sessionSummary([], 20)} />)
    expect(screen.getByText('No cards yet')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })
})

it('main relays the summary message', () => {
  expect(isToScanWindow({ kind: 'summary', summary: null })).toBe(true)
})
