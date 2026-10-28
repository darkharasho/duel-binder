import { createElement, type ReactElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanPrinting } from '@shared/scan/types'
import { useScanSession } from '@/features/scan/session'
import type { ScanDraft } from '@/features/scan/resolve'
import { createMockApi } from './mockApi'

const KEY = 'scan.session.v1'
const opt = (printingId: number, rarity: string): ScanPrinting => ({
  printingId,
  cardId: 1,
  name: 'Card 1',
  frameType: 'normal',
  setName: 'Set',
  setCode: `SET-EN00${printingId}`,
  rarity,
  language: 'en',
  price: null,
  imageIds: [10]
})
const draft = (extra: Partial<ScanDraft> = {}): ScanDraft => ({
  cardId: 1,
  name: 'Card 1',
  imageId: 10,
  printingId: 101,
  setCode: 'SET-EN001',
  rarity: 'Common',
  options: [opt(101, 'Common'), opt(102, 'Rare')],
  flag: 'check-rarity',
  via: 'code',
  ...extra
})

type Session = ReturnType<typeof useScanSession>

function setup(
  add = vi.fn(async () => ({}) as never)
): { add: typeof add } & RenderHookResult<Session, unknown> {
  window.api = createMockApi({ collection: { add } })
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }): ReactElement =>
    createElement(QueryClientProvider, { client }, children)
  return { add, ...renderHook(() => useScanSession(), { wrapper }) }
}

describe('useScanSession', () => {
  beforeEach(() => localStorage.clear())

  it('refreshPrices fills in missing prices and keeps the ones shown', async () => {
    const { result } = setup()
    act(() =>
      result.current.add(
        draft({ options: [{ ...opt(101, 'Common'), price: 2 }, opt(102, 'Rare')] })
      )
    )
    const printingsForCards = vi.fn(async () => [
      { ...opt(101, 'Common'), price: 9 },
      { ...opt(102, 'Rare'), price: 4 }
    ])
    window.api.scan.printingsForCards = printingsForCards
    await act(() => result.current.refreshPrices())
    expect(printingsForCards).toHaveBeenCalledWith([1])
    expect(result.current.rows[0].options.map((o) => o.price)).toEqual([2, 4])
    // Every price known: nothing to ask.
    await act(() => result.current.refreshPrices())
    expect(printingsForCards).toHaveBeenCalledTimes(1)
  })

  it('merges repeat scans', () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.add(draft({ cardId: 2, printingId: 201, imageId: 20 })))
    act(() => result.current.add(draft()))
    expect(result.current.rows.map((r) => [r.key, r.quantity])).toEqual([
      ['101:10', 2],
      ['201:20', 1]
    ])
    expect(result.current.total).toBe(3)
  })

  it('persists across remount', () => {
    const first = setup()
    act(() => first.result.current.add(draft()))
    first.unmount()
    const second = setup()
    expect(second.result.current.rows).toHaveLength(1)
  })

  it('survives corrupt storage', () => {
    localStorage.setItem(KEY, '{nope')
    expect(setup().result.current.rows).toEqual([])
    localStorage.setItem(KEY, '{"a":1}')
    expect(setup().result.current.rows).toEqual([])
  })

  it('rarity change merges rows', () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.add(draft({ printingId: 102, rarity: 'Rare', flag: null })))
    expect(result.current.rows).toHaveLength(2)
    act(() => result.current.setPrinting('101:10', 102))
    expect(result.current.rows).toHaveLength(1)
    const row = result.current.rows[0]
    expect(row).toMatchObject({ key: '102:10', quantity: 2, rarity: 'Rare', flag: null })
  })

  it('setPrinting updates fields, clears flags, ignores unknown printings', () => {
    const { result } = setup()
    act(() => result.current.add(draft({ flag: 'other-set' })))
    act(() => result.current.setPrinting('101:10', 999))
    expect(result.current.rows[0].flag).toBe('other-set')
    act(() => result.current.setPrinting('101:10', 102))
    expect(result.current.rows[0]).toMatchObject({
      printingId: 102,
      setCode: 'SET-EN00102',
      rarity: 'Rare',
      flag: null
    })
  })

  it('setQuantity below 1 removes the row', () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.setQuantity('101:10', 4))
    expect(result.current.rows[0].quantity).toBe(4)
    act(() => result.current.setQuantity('101:10', 0))
    expect(result.current.rows).toEqual([])
  })

  it('partial add keeps failed rows', async () => {
    const add = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom'))
    const { result } = setup(add)
    act(() => result.current.add(draft({ cardId: 2, printingId: 201, imageId: 20 })))
    act(() => result.current.add(draft()))
    let out = { added: 0, failed: 0 }
    await act(async () => {
      out = await result.current.commit()
    })
    expect(out).toEqual({ added: 1, failed: 1, cards: 1 })
    expect(add).toHaveBeenNthCalledWith(1, {
      printingId: 101,
      imageId: 10,
      quantity: 1,
      requestId: expect.stringMatching(/^101:10@\d+x1$/)
    })
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0]).toMatchObject({ key: '201:20', error: 'boom' })
  })

  it('rows needing a printing are not added', async () => {
    const { result, add } = setup()
    act(() => result.current.add(draft({ printingId: null, setCode: null, rarity: null })))
    let out = { added: 0, failed: 0 }
    await act(async () => {
      out = await result.current.commit()
    })
    expect(add).not.toHaveBeenCalled()
    expect(out).toEqual({ added: 0, failed: 0, cards: 0 })
    expect(result.current.rows[0].key).toBe('c1:10')
  })

  it('a second commit while one runs is a no-op', async () => {
    let release!: () => void
    const add = vi.fn(() => new Promise<never>((res) => (release = () => res({} as never))))
    const { result } = setup(add)
    act(() => result.current.add(draft()))
    let first!: Promise<{ added: number; failed: number }>
    let second = { added: -1, failed: -1 }
    await act(async () => {
      first = result.current.commit()
      second = await result.current.commit()
    })
    expect(second).toEqual({ added: 0, failed: 0, cards: 0 })
    expect(result.current.committing).toBe(true)
    await act(async () => {
      release()
      await first
    })
    expect(add).toHaveBeenCalledTimes(1)
    expect(result.current.committing).toBe(false)
  })

  it('keeps scans merged in during a commit', async () => {
    let release!: () => void
    const add = vi.fn(() => new Promise<never>((res) => (release = () => res({} as never))))
    const { result } = setup(add)
    act(() => result.current.add(draft()))
    let done!: Promise<unknown>
    await act(async () => {
      done = result.current.commit()
    })
    act(() => result.current.add(draft()))
    await act(async () => {
      release()
      await done
    })
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0].quantity).toBe(1)
  })

  it('names each add after the row as it stands, so a retry of the same row is the same add', async () => {
    const add = vi.fn().mockRejectedValueOnce(new Error('lost reply')).mockResolvedValue({})
    const { result } = setup(add)
    act(() => result.current.add(draft()))
    await act(async () => void (await result.current.commit()))
    await act(async () => void (await result.current.commit()))
    const ids = add.mock.calls.map(([input]) => (input as { requestId: string }).requestId)
    expect(ids[0]).toBe(ids[1])

    act(() => result.current.add(draft()))
    act(() => result.current.setQuantity('101:10', 3))
    await act(async () => void (await result.current.commit()))
    expect((add.mock.calls[2][0] as { requestId: string }).requestId).not.toBe(ids[0])
  })

  it("takes up the list another tab saved, so its next change doesn't write over it", () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    const other = [
      ...JSON.parse(localStorage.getItem(KEY)!),
      {
        ...draft({ cardId: 2, printingId: 201, imageId: 20 }),
        key: '201:20',
        quantity: 4,
        addedAt: 1
      }
    ]
    localStorage.setItem(KEY, JSON.stringify(other))
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: KEY })))
    expect(result.current.rows.map((r) => [r.key, r.quantity])).toEqual([
      ['101:10', 1],
      ['201:20', 4]
    ])
    act(() => result.current.add(draft()))
    const saved = JSON.parse(localStorage.getItem(KEY)!) as { key: string; quantity: number }[]
    expect(saved.map((r) => [r.key, r.quantity])).toEqual([
      ['101:10', 2],
      ['201:20', 4]
    ])
  })

  it('ignores non-finite quantities and floors the rest', () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.setQuantity('101:10', NaN))
    expect(result.current.rows[0].quantity).toBe(1)
    act(() => result.current.setQuantity('101:10', 2.9))
    expect(result.current.rows[0].quantity).toBe(2)
  })

  it('recomputes keys and drops malformed rows on load', () => {
    const good = { ...draft(), key: 'stale', quantity: 1, addedAt: 1 }
    localStorage.setItem(KEY, JSON.stringify([good, { ...good, options: [1] }]))
    const { result } = setup()
    expect(result.current.rows.map((r) => r.key)).toEqual(['101:10'])
  })

  it('clear empties storage', () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.clear())
    expect(result.current.rows).toEqual([])
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([])
  })

  it("drops the saved list when it can't be saved, so stale rows never come back", () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    expect(localStorage.getItem(KEY)).not.toBeNull()
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    act(() => result.current.add(draft({ cardId: 2, printingId: 201, imageId: 20 })))
    full.mockRestore()
    expect(localStorage.getItem(KEY)).toBeNull()
    // The list itself carries on for this session.
    expect(result.current.rows).toHaveLength(2)
  })
})
