import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { ScanHubProvider, useScanHub } from '@/features/scan/ScanHub'
import { listValue } from '@/features/scan/scanLook'
import type { ScanRow } from '@/features/scan/session'
import {
  REQUEST_DELAY_MS,
  checklistUnpriced,
  unpricedIntl,
  useRequestPrices
} from '@/lib/priceRequests'
import { createMockApi, renderWithProviders } from './mockApi'
import { printing } from './scanFakes'
import { metalRaidersChecklist, PRINTING } from './setFixtures'

const SESSION_KEY = 'scan.session.v1'

const row = (o: Partial<ScanRow>): ScanRow => ({
  key: '',
  cardId: 1,
  name: 'Dark Magician',
  imageId: 46986414,
  printingId: 101,
  setCode: 'LOB-EN005',
  rarity: 'Ultra Rare',
  options: [printing()],
  flag: null,
  via: 'code',
  quantity: 1,
  addedAt: 1,
  ...o
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  window.api = undefined as never
})

describe('unpricedIntl and checklistUnpriced', () => {
  it('keep only non-English printings with no price', () => {
    expect(
      unpricedIntl([
        { printingId: 1, language: 'ja', price: null },
        { printingId: 2, language: 'ja', price: 4 },
        { printingId: 3, language: 'en', price: null },
        { printingId: 4, language: 'ko', price: undefined }
      ])
    ).toEqual([1, 4])
  })

  it('a checklist asks for its unpriced rarities, and an English one for nothing', () => {
    const ja = {
      ...metalRaidersChecklist,
      set: { ...metalRaidersChecklist.set, language: 'ja' as const }
    }
    expect(checklistUnpriced(ja)).toEqual([PRINTING.beta])
    expect(checklistUnpriced(metalRaidersChecklist)).toEqual([])
    expect(checklistUnpriced(undefined)).toEqual([])
  })
})

describe('useRequestPrices', () => {
  it('asks once the printings have stayed on screen, and not again for the same ones', async () => {
    vi.useFakeTimers()
    const api = createMockApi()
    window.api = api
    const { rerender } = renderHook(({ ids }) => useRequestPrices(ids), {
      initialProps: { ids: [5, 6, 5] }
    })
    await act(() => vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS - 1))
    expect(api.prices.request).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(api.prices.request).toHaveBeenCalledWith([5, 6])
    rerender({ ids: [5, 6] })
    await act(() => vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS))
    expect(api.prices.request).toHaveBeenCalledTimes(1)
  })

  it('a page left quickly asks nothing; nothing to ask makes no call', async () => {
    vi.useFakeTimers()
    const api = createMockApi()
    window.api = api
    const { rerender, unmount } = renderHook(({ ids }) => useRequestPrices(ids), {
      initialProps: { ids: [] as number[] }
    })
    await act(() => vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS))
    rerender({ ids: [9] })
    await act(() => vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS / 2))
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS))
    expect(api.prices.request).not.toHaveBeenCalled()
  })

  it('a failed request is swallowed', async () => {
    vi.useFakeTimers()
    const api = createMockApi({
      prices: { request: vi.fn(async () => Promise.reject(new Error('x'))) }
    })
    window.api = api
    renderHook(() => useRequestPrices([1]))
    await act(() => vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS))
    expect(api.prices.request).toHaveBeenCalledTimes(1)
  })
})

function ListValue(): React.JSX.Element {
  const { session } = useScanHub()
  const { value, unpriced } = listValue(session.rows)
  return <p>{`value ${value} unpriced ${unpriced}`}</p>
}

describe('scan list prices', () => {
  it('asks for unpriced Japanese pulls and fills their prices in when a sync lands', async () => {
    const ja = printing({ printingId: 201, setCode: 'LOB-JP005', language: 'ja' })
    const jaOther = printing({ printingId: 202, setCode: 'LOB-JP006', language: 'ja' })
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify([
        row({ printingId: 201, setCode: 'LOB-JP005', options: [ja, jaOther] }),
        // An English pull with no price isn't asked for: TCGplayer prices English cards.
        row({ cardId: 2, printingId: 101, imageId: 2 })
      ])
    )
    let dataChanged: () => void = () => {}
    const printingsForCards = vi.fn(async () => [{ ...ja, price: 6.5 }, jaOther])
    const api = createMockApi({
      scan: { printingsForCards },
      app: {
        onDataChanged: (cb: () => void) => {
          dataChanged = cb
          return () => {}
        }
      }
    })
    renderWithProviders(
      <ScanHubProvider>
        <ListValue />
      </ScanHubProvider>,
      { api }
    )
    expect(screen.getByText('value 0 unpriced 2')).toBeInTheDocument()
    // Only the chosen printing of the Japanese row: the other options aren't on screen.
    await waitFor(() => expect(api.prices.request).toHaveBeenCalledWith([201]), { timeout: 3000 })

    act(() => dataChanged())
    expect(await screen.findByText('value 6.5 unpriced 1')).toBeInTheDocument()
    expect(printingsForCards).toHaveBeenCalledWith([1, 2])
  })
})
