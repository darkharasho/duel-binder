import { createElement, type ReactElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameId } from '@shared/games'
import type { OcrBand, ScanPrinting } from '@shared/scan/types'
import type { RawSignals } from '@/features/scan/engine'
import { useScanSession } from '@/features/scan/session'
import { ScanHubProvider, useScanHub, READ_FLASH_MS, type ScanHub } from '@/features/scan/ScanHub'
import { GameProvider } from '@/lib/game'
import type { ScanDraft } from '@/features/scan/resolve'
import { useScanLoop } from '@/features/scan/useScanLoop'
import { createMockApi, renderWithProviders } from './mockApi'
import { mutationInvalidationKeys } from '@/lib/api'
import { fakeBridge, fakeEngine, quad, stubVideo, type FakeEngine } from './scanFakes'

const KEY = 'scan.session.v1'
const ids = (r: Session): string[] => r.rows.map((x) => x.key)
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
  add = vi.fn(async () => ({}) as never),
  game?: GameId
): { add: typeof add; client: QueryClient } & RenderHookResult<Session, { game?: GameId }> {
  window.api = createMockApi({ collection: { add } })
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }): ReactElement =>
    createElement(QueryClientProvider, { client }, children)
  return {
    add,
    client,
    ...renderHook((props: { game?: GameId }) => useScanSession(props.game), {
      wrapper,
      initialProps: { game } as { game?: GameId }
    })
  }
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

  it('two scans of the same card are two rows', () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.add(draft({ cardId: 2, printingId: 201, imageId: 20 })))
    act(() => result.current.add(draft()))
    expect(result.current.rows.map((r) => [r.printingId, r.quantity])).toEqual([
      [101, 1],
      [201, 1],
      [101, 1]
    ])
    expect(new Set(ids(result.current)).size).toBe(3)
    expect(result.current.total).toBe(3)
  })

  it('add returns the key of the new row', () => {
    const { result } = setup()
    let first = ''
    let second = ''
    act(() => {
      first = result.current.add(draft())
      second = result.current.add(draft())
    })
    expect(first).not.toBe(second)
    expect(result.current.rows[0].key).toBe(second)
    expect(result.current.rows[1].key).toBe(first)
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

  it("changing one row's rarity leaves the other alone", () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.add(draft()))
    const [newer, older] = result.current.rows.map((r) => r.key)
    act(() => result.current.setPrinting(newer, 102))
    expect(result.current.rows).toHaveLength(2)
    expect(result.current.rows[0]).toMatchObject({
      key: newer,
      printingId: 102,
      rarity: 'Rare',
      flag: null
    })
    expect(result.current.rows[1]).toMatchObject({ key: older, printingId: 101, rarity: 'Common' })
  })

  it('two rows can hold the same printing after an edit', () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.add(draft({ printingId: 102, rarity: 'Rare', flag: null })))
    const [rare, common] = result.current.rows.map((r) => r.key)
    act(() => result.current.setPrinting(common, 102))
    expect(result.current.rows.map((r) => [r.key, r.printingId, r.quantity])).toEqual([
      [rare, 102, 1],
      [common, 102, 1]
    ])
  })

  it('a best guess stays a guess until its printing is picked, and stays its own row', () => {
    const { result } = setup()
    act(() => result.current.add(draft({ flag: null })))
    act(() => result.current.add(draft({ flag: null, guess: true })))
    expect(result.current.rows).toHaveLength(2)
    expect(result.current.rows[0].guess).toBe(true)
    expect('guess' in result.current.rows[1]).toBe(false)
    act(() => result.current.setPrinting(result.current.rows[0].key, 102))
    expect('guess' in result.current.rows[0]).toBe(false)
  })

  it('setPrinting updates fields, clears flags, ignores unknown printings', () => {
    const { result } = setup()
    act(() => result.current.add(draft({ flag: 'other-set' })))
    const key = result.current.rows[0].key
    act(() => result.current.setPrinting(key, 999))
    expect(result.current.rows[0].flag).toBe('other-set')
    act(() => result.current.setPrinting(key, 102))
    expect(result.current.rows[0]).toMatchObject({
      printingId: 102,
      setCode: 'SET-EN00102',
      rarity: 'Rare',
      flag: null
    })
  })

  it("setPrinting to a reprint in another set takes that card's name and artwork", () => {
    const { result } = setup(undefined, 'pkm')
    const reprint = { ...opt(301, 'Holofoil'), cardId: 3, name: 'Card 3', imageIds: [30] }
    act(() => result.current.add(draft({ game: 'pkm', options: [opt(101, 'Common'), reprint] })))
    act(() => result.current.setPrinting(result.current.rows[0].key, 301))
    expect(result.current.rows[0]).toMatchObject({
      cardId: 3,
      name: 'Card 3',
      imageId: 30,
      printingId: 301,
      setCode: 'SET-EN00301',
      flag: null
    })
  })

  it('setQuantity below 1 removes the row', () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    const key = result.current.rows[0].key
    act(() => result.current.setQuantity(key, 4))
    expect(result.current.rows[0].quantity).toBe(4)
    act(() => result.current.setQuantity(key, 0))
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
      requestId: expect.stringMatching(/^101:10#.+@101x1$/)
    })
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0]).toMatchObject({ printingId: 201, error: 'boom' })
  })

  describe('recording a session', () => {
    const priced = (price: number): ScanDraft =>
      draft({ options: [{ ...opt(101, 'Common'), price }, opt(102, 'Rare')] })
    const other = (price: number): ScanDraft =>
      draft({
        cardId: 2,
        printingId: 201,
        imageId: 20,
        options: [{ ...opt(201, 'Common'), cardId: 2, price, imageIds: [20] }]
      })

    it('records the cards that were added, with their prices, once', async () => {
      const add = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('x'))
      add.mockResolvedValueOnce({})
      const { result } = setup(add)
      const record = vi.fn(async () => undefined)
      window.api.sessions.record = record
      act(() => result.current.add(priced(5)))
      act(() => result.current.add(other(7)))
      act(() => result.current.add(draft({ cardId: 3, printingId: 301, imageId: 30 })))
      await act(async () => void (await result.current.commit()))
      expect(record).toHaveBeenCalledTimes(1)
      const [arg] = record.mock.calls[0] as unknown as [
        { uid: string; game: string; cards: Array<Record<string, unknown>> }
      ]
      expect(arg.uid).toMatch(/.+/)
      expect(arg.game).toBe('ygo')
      expect(arg.cards.map((c) => [c.printingId, c.price, c.quantity])).toEqual([
        [301, null, 1],
        [101, 5, 1]
      ])
    })

    it('does not record when every add fails', async () => {
      const add = vi.fn().mockRejectedValue(new Error('boom'))
      const { result } = setup(add)
      const record = vi.fn(async () => undefined)
      window.api.sessions.record = record
      act(() => result.current.add(draft()))
      await act(async () => void (await result.current.commit()))
      expect(record).not.toHaveBeenCalled()
    })

    it('records the quantity that was added, not one raised meanwhile', async () => {
      let release!: () => void
      const add = vi.fn(() => new Promise<never>((res) => (release = () => res({} as never))))
      const { result } = setup(add)
      const record = vi.fn(async () => undefined)
      window.api.sessions.record = record
      act(() => result.current.add(draft()))
      const key = result.current.rows[0].key
      let done!: Promise<unknown>
      await act(async () => {
        done = result.current.commit()
      })
      act(() => result.current.setQuantity(key, 3))
      await act(async () => {
        release()
        await done
      })
      const [arg] = record.mock.calls[0] as unknown as [{ cards: Array<{ quantity: number }> }]
      expect(arg.cards.map((c) => c.quantity)).toEqual([1])
    })

    it('every edit refreshes the sessions, and so does a record once it lands', async () => {
      expect(mutationInvalidationKeys).toContainEqual(['sessions'])
      const { result, client } = setup()
      let land!: () => void
      window.api.sessions.record = vi.fn(() => new Promise<void>((res) => (land = res)))
      const invalidate = vi.spyOn(client, 'invalidateQueries')
      act(() => result.current.add(draft()))
      await act(async () => void (await result.current.commit()))
      invalidate.mockClear()
      await act(async () => land())
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions'] })
    })

    it('a failing record leaves commit as it was', async () => {
      const { result } = setup()
      window.api.sessions.record = vi.fn(() => Promise.reject(new Error('no')))
      act(() => result.current.add(draft()))
      let out = { added: 0, failed: 0, cards: 0 }
      await act(async () => {
        out = await result.current.commit()
      })
      expect(out).toEqual({ added: 1, failed: 0, cards: 1 })
    })
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
    expect(result.current.rows[0].key).toMatch(/^c1:10#/)
  })

  it('a Pokémon row whose version is still to be picked is not added', async () => {
    const { result, add } = setup(undefined, 'pkm')
    act(() => result.current.add(draft({ game: 'pkm', flag: 'pick-printing', via: 'art' })))
    let out = { added: 0, failed: 0 }
    await act(async () => {
      out = await result.current.commit()
    })
    expect(add).not.toHaveBeenCalled()
    expect(out).toEqual({ added: 0, failed: 0, cards: 0 })
    // Once picked, it is.
    act(() => result.current.setPrinting(result.current.rows[0].key, 102))
    await act(async () => {
      out = await result.current.commit()
    })
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ printingId: 102 }))
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

  it('keeps scans made during a commit', async () => {
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

  it('takes off only what was added when the quantity is raised during a commit', async () => {
    let release!: () => void
    const add = vi.fn(() => new Promise<never>((res) => (release = () => res({} as never))))
    const { result } = setup(add)
    act(() => result.current.add(draft()))
    const key = result.current.rows[0].key
    let done!: Promise<unknown>
    await act(async () => {
      done = result.current.commit()
    })
    act(() => result.current.setQuantity(key, 3))
    await act(async () => {
      release()
      await done
    })
    expect(result.current.rows.map((r) => r.quantity)).toEqual([2])
  })

  it('commit tells listeners what it saved', async () => {
    let release!: () => void
    const add = vi.fn(() => new Promise<never>((res) => (release = () => res({} as never))))
    const { result } = setup(add)
    const heard: [string, number][] = []
    const off = result.current.onSaved((k, q) => heard.push([k, q]))
    act(() => result.current.add(draft()))
    const key = result.current.rows[0].key
    act(() => result.current.setQuantity(key, 2))
    let done!: Promise<unknown>
    await act(async () => {
      done = result.current.commit()
    })
    act(() => result.current.setQuantity(key, 3))
    await act(async () => {
      release()
      await done
    })
    expect(heard).toEqual([[key, 2]])
    expect(result.current.rows.map((r) => r.quantity)).toEqual([1])

    off()
    act(() => result.current.setQuantity(key, 1))
    await act(async () => {
      const p = result.current.commit()
      release()
      await p
    })
    expect(heard).toHaveLength(1)
  })

  it('rows of the same printing are added separately, each under its own id', async () => {
    const { result, add } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.add(draft()))
    await act(async () => void (await result.current.commit()))
    expect(add).toHaveBeenCalledTimes(2)
    const sent = add.mock.calls.map(
      (c) => (c as unknown[])[0] as { printingId: number; requestId: string }
    )
    expect(sent.map((i) => i.printingId)).toEqual([101, 101])
    expect(sent[0].requestId).not.toBe(sent[1].requestId)
    expect(result.current.rows).toEqual([])
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
    await act(async () => void (await result.current.commit()))
    expect(result.current.rows).toEqual([])
    // A new row of the same printing, and an edit of a failed row, each get another id.
    const failing = vi.fn().mockRejectedValue(new Error('down'))
    const again = setup(failing)
    act(() => again.result.current.add(draft()))
    act(() => again.result.current.add(draft()))
    await act(async () => void (await again.result.current.commit()))
    const same = failing.mock.calls.map(([i]) => (i as { requestId: string }).requestId)
    expect(same[0]).not.toBe(same[1])
    act(() => again.result.current.setPrinting(again.result.current.rows[0].key, 102))
    failing.mockClear()
    await act(async () => void (await again.result.current.commit()))
    const after = failing.mock.calls.map(([i]) => (i as { requestId: string }).requestId)
    expect(after).not.toContain(same[0])
    expect(after).toContain(same[1])
  })

  it("takes up the list another tab saved, so its next change doesn't write over it", () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    const other = [
      ...JSON.parse(localStorage.getItem(KEY)!),
      {
        ...draft({ cardId: 2, printingId: 201, imageId: 20 }),
        key: '201:20#a',
        quantity: 4,
        addedAt: 1
      }
    ]
    localStorage.setItem(KEY, JSON.stringify(other))
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: KEY })))
    expect(result.current.rows.map((r) => r.quantity)).toEqual([1, 4])
    act(() => result.current.add(draft()))
    const saved = JSON.parse(localStorage.getItem(KEY)!) as { key: string; quantity: number }[]
    expect(saved.map((r) => r.quantity)).toEqual([1, 1, 4])
  })

  it('ignores non-finite quantities and floors the rest', () => {
    const { result } = setup()
    act(() => result.current.add(draft()))
    const key = result.current.rows[0].key
    act(() => result.current.setQuantity(key, NaN))
    expect(result.current.rows[0].quantity).toBe(1)
    act(() => result.current.setQuantity(key, 2.9))
    expect(result.current.rows[0].quantity).toBe(2)
  })

  it('recomputes keys of older lists and drops malformed rows on load', () => {
    const good = { ...draft(), key: 'stale', quantity: 1, addedAt: 1 }
    localStorage.setItem(KEY, JSON.stringify([good, { ...good, options: [1] }]))
    const { result } = setup()
    expect(result.current.rows.map((r) => r.key)).toEqual(['101:10'])
  })

  it('loads an old saved list with its quantities, one row each, and keeps unique keys', () => {
    const old = { ...draft(), key: '101:10', quantity: 3, addedAt: 1 }
    const own = { ...draft(), key: '101:10#abc', quantity: 1, addedAt: 2 }
    localStorage.setItem(KEY, JSON.stringify([old, own]))
    const { result } = setup()
    expect(result.current.rows.map((r) => [r.key, r.quantity])).toEqual([
      ['101:10', 3],
      ['101:10#abc', 1]
    ])
    expect(result.current.total).toBe(4)
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

  describe('applyRead', () => {
    const reread = (extra: Partial<ScanDraft> = {}): ScanDraft =>
      draft({ printingId: 102, setCode: 'SET-EN002', rarity: 'Rare', ...extra })

    it('applies to an untouched flagged row, keeping the flag and everything else', () => {
      const { result } = setup()
      let key = ''
      act(() => void (key = result.current.add(draft())))
      let ok = false
      act(() => void (ok = result.current.applyRead(key, reread())))
      expect(ok).toBe(true)
      const row = result.current.rows[0]
      expect(row).toMatchObject({
        key,
        quantity: 1,
        printingId: 102,
        setCode: 'SET-EN002',
        rarity: 'Rare',
        flag: 'check-rarity',
        read: true
      })
      expect(JSON.parse(localStorage.getItem(KEY)!)[0]).toMatchObject({
        rarity: 'Rare',
        read: true
      })
    })

    it('refuses a row the user has touched', () => {
      const { result } = setup()
      let key = ''
      act(() => void (key = result.current.add(draft())))
      act(() => result.current.setPrinting(key, 101))
      let ok = true
      act(() => void (ok = result.current.applyRead(key, reread())))
      expect(ok).toBe(false)
      expect(result.current.rows[0]).toMatchObject({
        printingId: 101,
        rarity: 'Common',
        flag: null
      })
      expect(result.current.rows[0].read).toBeUndefined()
    })

    it('refuses a row whose quantity the user has changed', () => {
      const { result } = setup()
      let key = ''
      act(() => void (key = result.current.add(draft())))
      act(() => result.current.setQuantity(key, 3))
      let ok = true
      act(() => void (ok = result.current.applyRead(key, reread())))
      expect(ok).toBe(false)
      expect(result.current.rows[0]).toMatchObject({
        quantity: 3,
        printingId: 101,
        rarity: 'Common',
        flag: 'check-rarity'
      })
    })

    it('keeps a pick-printing flag, and Add still skips the row', async () => {
      const add = vi.fn(async () => ({}) as never)
      const { result } = setup(add, 'pkm')
      let key = ''
      act(() => void (key = result.current.add(draft({ game: 'pkm', flag: 'pick-printing' }))))
      let ok = false
      act(() => void (ok = result.current.applyRead(key, reread({ game: 'pkm', flag: null }))))
      expect(ok).toBe(true)
      expect(result.current.rows[0]).toMatchObject({ flag: 'pick-printing', rarity: 'Rare' })
      await act(async () => void (await result.current.commit()))
      expect(add).not.toHaveBeenCalled()
    })

    it('refuses a removed row', () => {
      const { result } = setup()
      let key = ''
      act(() => void (key = result.current.add(draft())))
      act(() => result.current.remove(key))
      let ok = true
      act(() => void (ok = result.current.applyRead(key, reread())))
      expect(ok).toBe(false)
      expect(result.current.rows).toEqual([])
    })

    it('refuses while a commit is pending', async () => {
      let release!: () => void
      const add = vi.fn(() => new Promise<never>((res) => (release = () => res({} as never))))
      const { result } = setup(add)
      let key = ''
      act(() => void (key = result.current.add(draft({ flag: 'check-rarity' }))))
      let done!: Promise<unknown>
      await act(async () => {
        done = result.current.commit()
        await Promise.resolve()
      })
      let ok = true
      act(() => void (ok = result.current.applyRead(key, reread())))
      expect(ok).toBe(false)
      await act(async () => {
        release()
        await done
      })
    })

    it('applies once to a row, never flipping back', () => {
      const { result } = setup()
      let key = ''
      act(() => void (key = result.current.add(draft())))
      act(() => void result.current.applyRead(key, reread()))
      let ok = true
      act(() => void (ok = result.current.applyRead(key, draft())))
      expect(ok).toBe(false)
      expect(result.current.rows[0].rarity).toBe('Rare')
    })

    it('refuses a reading of another card', () => {
      const { result } = setup()
      let key = ''
      act(() => void (key = result.current.add(draft())))
      let ok = true
      act(() => void (ok = result.current.applyRead(key, reread({ cardId: 2 }))))
      expect(ok).toBe(false)
      expect(result.current.rows[0].rarity).toBe('Common')
    })

    it('a saved read marker survives a reload', () => {
      const first = setup()
      let key = ''
      act(() => void (key = first.result.current.add(draft())))
      act(() => void first.result.current.applyRead(key, reread()))
      const again = setup()
      let ok = true
      act(() => void (ok = again.result.current.applyRead(key, draft())))
      expect(ok).toBe(false)
    })
  })
})

const textBand: OcrBand = { width: 4, height: 2, data: new Uint8Array(8) }
const EN_TEXT = 'Pikachu HP 60 Basic Pokémon Gnaw 10 Weakness Resistance Retreat Cost'
// Japanese needs Japanese card words, not just kana (pokemonLanguage).
const JA_TEXT = 'ピカチュウ HP 60 ワザ 相手のバトルポケモンに10ダメージ'

const pkmPrinting = (o: Partial<ScanPrinting>): ScanPrinting => ({
  printingId: 501,
  cardId: 5,
  name: 'Pikachu',
  frameType: 'pokemon',
  setName: 'Paldea Evolved',
  setCode: 'PAL 045/193',
  rarity: 'Normal',
  language: 'en',
  price: 1,
  imageIds: [500],
  ...o
})

/** A Pokémon card in view, its art matched and its text block cut out. */
const pkmFrame: RawSignals = {
  found: true,
  quad,
  art: [{ imageId: 500, distance: 10 }],
  codeTexts: [],
  nameTexts: [],
  textBands: [textBand],
  cues: null,
  look: null
}

describe('useScanLoop', () => {
  beforeEach(() => {
    localStorage.clear()
    stubVideo()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const run = (ms = 0): Promise<void> =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })

  function loop(
    factory: (game: GameId) => FakeEngine,
    game: GameId,
    onDraft = vi.fn()
  ): ReturnType<typeof renderHook<unknown, { game: GameId }>> & { onDraft: typeof onDraft } {
    const video = document.createElement('video')
    const rendered = renderHook(
      ({ game }: { game: GameId }) =>
        useScanLoop({
          videoRef: { current: video },
          engineFactory: factory,
          game,
          running: true,
          setKey: 'any',
          setPrintings: null,
          defaultRarity: null,
          // Given, as the phone does: a Pokémon card is never read by it.
          lookModel: { classes: [] } as never,
          onDraft
        }),
      { initialProps: { game } }
    )
    return { ...rendered, onDraft }
  }

  it('scan loop re-inits when the game changes', async () => {
    const files = { ygo: new ArrayBuffer(1), pkm: new ArrayBuffer(2) }
    const fingerprints = vi.fn(async (game: GameId) => files[game])
    window.api = createMockApi({ scan: { fingerprints } })
    const engines: { game: GameId; engine: FakeEngine }[] = []
    const factory = vi.fn((game: GameId) => {
      const engine = fakeEngine()
      engines.push({ game, engine })
      return engine
    })
    const { rerender } = loop(factory, 'ygo')
    await run(500)
    expect(engines.map((e) => e.game)).toEqual(['ygo'])
    expect(fingerprints).toHaveBeenLastCalledWith('ygo')
    expect(engines[0].engine.init).toHaveBeenCalledWith(files.ygo, [])
    expect(engines[0].engine.analyze).toHaveBeenCalled()

    rerender({ game: 'pkm' })
    await run(500)
    expect(engines.map((e) => e.game)).toEqual(['ygo', 'pkm'])
    expect(engines[0].engine.dispose).toHaveBeenCalled()
    expect(fingerprints).toHaveBeenLastCalledWith('pkm')
    expect(window.api.scan.refreshFingerprints).toHaveBeenLastCalledWith('pkm')
    // Refs are Yu-Gi-Oh's only: asked for once, for its file.
    expect(engines[1].engine.init).toHaveBeenCalledWith(files.pkm, [])
    expect(window.api.scan.fingerprintRefs).toHaveBeenCalledTimes(1)
    expect(engines[1].engine.analyze).toHaveBeenCalled()
    const ygoFrames = engines[0].engine.analyze.mock.calls.length
    await run(1000)
    expect(engines[0].engine.analyze.mock.calls.length).toBe(ygoFrames)
  })

  it("drops a frame the old game's engine was still analyzing", async () => {
    window.api = createMockApi({
      scan: {
        printingsByCode: vi.fn(async () => [pkmPrinting({ frameType: 'normal' })])
      }
    })
    let answer: (s: RawSignals) => void = () => {}
    const ygo = fakeEngine()
    ygo.analyze.mockImplementation(() => new Promise<RawSignals>((r) => (answer = r)))
    const pkm = fakeEngine()
    const { rerender, onDraft } = loop((game) => (game === 'ygo' ? ygo : pkm), 'ygo')
    await run(500)
    expect(ygo.analyze).toHaveBeenCalledTimes(1)
    rerender({ game: 'pkm' })
    await run()
    answer({ ...pkmFrame, art: [], codeTexts: ['LOB-EN005'], textBands: [] })
    await run(1000)
    expect(window.api.scan.printingsByCode).not.toHaveBeenCalled()
    expect(onDraft).not.toHaveBeenCalled()
  })

  it('a Pokémon loop tells the language from a read per model, never the look model', async () => {
    const readText = vi.fn(async (_bands: OcrBand[], model: 'eng' | 'jpn') => [
      model === 'eng' ? EN_TEXT : 'l1 ,. ii'
    ])
    window.api = createMockApi({
      scan: {
        readText,
        cardsForImages: vi.fn(async () => [{ imageId: 500, cardId: 5 }]),
        printingsForCards: vi.fn(async () => [
          pkmPrinting({}),
          pkmPrinting({ printingId: 502, rarity: 'Reverse Holofoil', price: 3.5 })
        ])
      }
    })
    const engine = fakeEngine(() => pkmFrame)
    const { onDraft } = loop(() => engine, 'pkm')
    await run(2000)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(onDraft.mock.calls[0][0]).toMatchObject({
      cardId: 5,
      game: 'pkm',
      flag: 'check-rarity'
    })
    expect(readText).toHaveBeenCalledWith([textBand], 'jpn')
    expect(readText).toHaveBeenCalledWith([textBand], 'eng')
    // Read once while the card stays in view, not on every frame.
    expect(readText).toHaveBeenCalledTimes(2)
    expect(window.api.scan.language).not.toHaveBeenCalled()
    expect(engine.analyze.mock.calls.every(([, o]) => !o.wantLook)).toBe(true)
  })

  it('a Pokémon card whose reads disagree is not named', async () => {
    const readText = vi.fn(async (_bands: OcrBand[], model: 'eng' | 'jpn') => [
      model === 'eng' ? EN_TEXT : JA_TEXT
    ])
    window.api = createMockApi({
      scan: {
        readText,
        cardsForImages: vi.fn(async () => [{ imageId: 500, cardId: 5 }]),
        printingsForCards: vi.fn(async () => [pkmPrinting({})])
      }
    })
    const { onDraft, result } = loop(() => fakeEngine(() => pkmFrame), 'pkm')
    await run(2000)
    expect(readText).toHaveBeenCalled()
    expect(onDraft).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ status: { kind: 'unsure' } })
  })
})

describe('useScanSession per game', () => {
  beforeEach(() => localStorage.clear())
  const pkm = (extra: Partial<ScanDraft> = {}): ScanDraft => draft({ game: 'pkm', ...extra })

  it("shows and counts only the active game's rows, and keeps the other's", () => {
    const { result, rerender } = setup()
    act(() => result.current.add(draft()))
    act(() => result.current.add(draft()))
    rerender({ game: 'pkm' })
    expect(result.current.rows).toEqual([])
    expect(result.current.total).toBe(0)
    act(() => result.current.add(pkm()))
    expect(result.current.rows.map((r) => r.game)).toEqual(['pkm'])
    expect(result.current.total).toBe(1)
    rerender({ game: 'ygo' })
    expect(result.current.total).toBe(2)
    expect(result.current.rows[0].game).toBeUndefined()
  })

  it('keeps a Pokémon row apart from a Yu-Gi-Oh row with the same ids', () => {
    const { result, rerender } = setup(undefined, 'pkm')
    act(() => result.current.add(pkm()))
    rerender({ game: 'ygo' })
    act(() => result.current.add(draft()))
    expect(result.current.total).toBe(1)
    rerender({ game: 'pkm' })
    expect(result.current.total).toBe(1)
  })

  it("Add sends only the active game's rows", async () => {
    const { add, result, rerender } = setup()
    act(() => result.current.add(draft()))
    rerender({ game: 'pkm' })
    act(() => result.current.add(pkm({ printingId: 500, imageId: 50, options: [opt(500, '')] })))
    await act(async () => void (await result.current.commit()))
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ printingId: 500 }))
    rerender({ game: 'ygo' })
    expect(result.current.total).toBe(1)
  })

  it("Clear takes only the active game's rows", () => {
    const { result, rerender } = setup()
    act(() => result.current.add(draft()))
    rerender({ game: 'pkm' })
    act(() => result.current.add(pkm()))
    act(() => result.current.clear())
    expect(result.current.total).toBe(0)
    rerender({ game: 'ygo' })
    expect(result.current.total).toBe(1)
  })

  it('reads a saved list with no game as Yu-Gi-Oh', () => {
    localStorage.setItem(KEY, JSON.stringify([{ ...draft(), key: 'x', quantity: 1, addedAt: 1 }]))
    expect(setup().result.current.total).toBe(1)
    expect(setup(undefined, 'pkm').result.current.total).toBe(0)
  })
})

describe('the hub applies a read and flashes the row', () => {
  const next = draft({ printingId: 102, setCode: 'SET-EN002', rarity: 'Rare' })

  function Probe({ out }: { out: { hub?: ScanHub } }): null {
    out.hub = useScanHub()
    return null
  }
  function mountHub(): { hub: ScanHub } {
    const out: { hub?: ScanHub } = {}
    renderWithProviders(
      createElement(
        GameProvider,
        null,
        createElement(ScanHubProvider, null, createElement(Probe, { out }))
      ),
      { api: createMockApi({ scanWindow: fakeBridge().scanWindow }) }
    )
    return out as { hub: ScanHub }
  }

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('flashes an applied row for READ_FLASH_MS, and a refused one not at all', async () => {
    const out = mountHub()
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
    let key = ''
    act(() => void (key = out.hub.count(draft())))
    act(() => out.hub.reread(key, next))
    expect(out.hub.flashed).toBe(key)
    act(() => void vi.advanceTimersByTime(READ_FLASH_MS - 1))
    expect(out.hub.flashed).toBe(key)
    act(() => void vi.advanceTimersByTime(1))
    expect(out.hub.flashed).toBeNull()
    act(() => out.hub.reread(key, next))
    expect(out.hub.flashed).toBeNull()
  })

  it('a newer reread takes the flash and restarts its timer', async () => {
    const out = mountHub()
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
    let a = ''
    let b = ''
    act(() => void (a = out.hub.count(draft())))
    act(() => void (b = out.hub.count(draft())))
    act(() => out.hub.reread(a, next))
    act(() => void vi.advanceTimersByTime(READ_FLASH_MS - 100))
    act(() => out.hub.reread(b, next))
    expect(out.hub.flashed).toBe(b)
    act(() => void vi.advanceTimersByTime(READ_FLASH_MS - 100))
    expect(out.hub.flashed).toBe(b)
    act(() => void vi.advanceTimersByTime(100))
    expect(out.hub.flashed).toBeNull()
  })
})
