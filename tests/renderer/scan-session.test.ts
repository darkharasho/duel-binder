import { createElement, type ReactElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameId } from '@shared/games'
import type { OcrBand, ScanPrinting } from '@shared/scan/types'
import type { RawSignals } from '@/features/scan/engine'
import { useScanSession } from '@/features/scan/session'
import type { ScanDraft } from '@/features/scan/resolve'
import { useScanLoop } from '@/features/scan/useScanLoop'
import { createMockApi } from './mockApi'
import { fakeEngine, quad, stubVideo, type FakeEngine } from './scanFakes'

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
  add = vi.fn(async () => ({}) as never),
  game?: GameId
): { add: typeof add } & RenderHookResult<Session, { game?: GameId }> {
  window.api = createMockApi({ collection: { add } })
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }): ReactElement =>
    createElement(QueryClientProvider, { client }, children)
  return {
    add,
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

  it('a best guess stays marked when merged, and is one no longer once a printing is picked', () => {
    const { result } = setup()
    act(() => result.current.add(draft({ flag: null })))
    act(() => result.current.add(draft({ flag: null, guess: true })))
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0]).toMatchObject({ quantity: 2, guess: true })
    act(() => result.current.setPrinting('101:10', 102))
    expect('guess' in result.current.rows[0]).toBe(false)
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
          setName: null,
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
      flag: 'pick-printing'
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
