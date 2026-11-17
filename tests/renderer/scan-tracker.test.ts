import { describe, expect, it } from 'vitest'
import { createShowingTracker } from '@/features/scan/tracker'
import type { ScanDraft, ScanOutcome } from '@/features/scan/resolve'
import type { ScanPrinting } from '@shared/scan/types'

const draft = (cardId: number, imageId = cardId * 10): ScanDraft => ({
  cardId,
  name: `Card ${cardId}`,
  imageId,
  printingId: cardId * 100,
  setCode: null,
  rarity: null,
  options: [],
  flag: null,
  via: 'art'
})
const seen = (cardId: number): ScanOutcome => ({ kind: 'recognized', item: draft(cardId) })
const as = (d: Partial<ScanDraft>): ScanOutcome => ({
  kind: 'recognized',
  item: { ...draft(1), ...d }
})
const NONE: ScanOutcome = { kind: 'none' }
const UNSURE: ScanOutcome = { kind: 'unsure' }
const FAR: ScanOutcome = { kind: 'none', far: true }

/** Pushes outcomes 100 ms apart from start and returns the card ids counted. */
function run(
  tracker: ReturnType<typeof createShowingTracker>,
  outcomes: ScanOutcome[],
  start = 0
): number[] {
  return outcomes.flatMap((o, i) => {
    const d = tracker.push(start + i * 100, o)
    return d ? [d.cardId] : []
  })
}

describe('createShowingTracker', () => {
  describe('a best guess', () => {
    const guess = (cardId: number): ScanOutcome => as({ ...draft(cardId), guess: true })
    const tracker = (): ReturnType<typeof createShowingTracker> =>
      createShowingTracker({ stableFrames: 2, guessFrames: 4, swapFrames: 8, absentMs: 600 })

    it('counts only after holding for its frames', () => {
      const t = tracker()
      expect(run(t, [guess(1), guess(1), guess(1)])).toEqual([])
      expect(run(t, [guess(1)], 300)).toEqual([1])
    })

    it('gives way to a certain answer, which counts at once and as certain', () => {
      const t = tracker()
      expect(run(t, [guess(1), guess(1), seen(2), seen(2)])).toEqual([2])
      const u = tracker()
      u.push(0, guess(1))
      expect(u.push(100, seen(1))?.guess).toBeUndefined()
    })

    it('takes twice as long while a card counted has not cleared, as it may be its twin', () => {
      const t = tracker()
      expect(run(t, [seen(1), seen(1), ...Array(7).fill(guess(2))])).toEqual([1])
      expect(run(t, [guess(2)], 1000)).toEqual([2])
    })

    it('starts over on any frame of the card still shown', () => {
      const t = tracker()
      const flicker = [...Array(7).fill(guess(2)), seen(1), ...Array(7).fill(guess(2))]
      expect(run(t, [seen(1), seen(1), ...flicker])).toEqual([1])
    })

    it('counts for the next card once the view has cleared', () => {
      const t = tracker()
      run(t, [seen(1), seen(1), NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE])
      expect(run(t, [guess(2), guess(2), guess(2), guess(2)], 2000)).toEqual([2])
    })
  })

  it('counts once across flicker', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), UNSURE, seen(1), seen(1), UNSURE, seen(1), seen(1)])).toEqual([1])
  })

  it('needs stableFrames consecutive frames', () => {
    const t = createShowingTracker({ stableFrames: 3, absentMs: 600 })
    expect(run(t, [seen(1), seen(1), NONE, seen(1), seen(1)])).toEqual([])
    expect(run(t, [seen(1)], 500)).toEqual([1])
  })

  it('same card again after absence counts again', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const nones = Array<ScanOutcome>(7).fill(NONE)
    expect(run(t, [seen(1), seen(1), ...nones, seen(1), seen(1)])).toEqual([1, 1])
  })

  it('brief absence under absentMs does not recount', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), seen(1), NONE, NONE, NONE, seen(1), seen(1)])).toEqual([1])
    // An unsure frame breaks the absence too: the card is still in view.
    expect(run(t, [NONE, NONE, NONE, UNSURE, NONE, NONE, NONE, seen(1), seen(1)], 1000)).toEqual([])
  })

  it('one card read by code, then art, then code counts once', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const code = as({ printingId: 13, via: 'code' })
    const art = as({ printingId: null, via: 'art', flag: 'pick-printing' })
    expect(run(t, [code, code, art, art, code, code])).toEqual([1])
  })

  it('alternating artworks of one card count once', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const a = as({ imageId: 101 })
    const b = as({ imageId: 102 })
    expect(run(t, [a, b, a, b, a, b, a])).toEqual([1])
  })

  it('a single none frame is no absence, however late the card comes back', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const counted = [
      t.push(0, seen(1)),
      t.push(100, seen(1)),
      t.push(200, NONE),
      t.push(800, seen(1)),
      t.push(900, seen(1))
    ].filter(Boolean)
    expect(counted).toHaveLength(1)
  })

  it('different card counts without absence', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), seen(1), seen(2), seen(2), seen(3), seen(3)])).toEqual([1, 2, 3])
  })

  describe('a pile of counted cards in view', () => {
    const tracker = (): ReturnType<typeof createShowingTracker> =>
      createShowingTracker({ stableFrames: 2, absentMs: 600, recentCards: 3 })

    it('a card counted lately, seen again on the pile, does not count again', () => {
      // 1 held and counted, dropped on the pile; 2 held over it and counted; 2 lowered: 1 shows.
      const t = tracker()
      expect(run(t, [seen(1), seen(1), seen(2), seen(2), seen(1), seen(1), seen(1)])).toEqual([
        1, 2
      ])
      expect(t.heldBack()?.cardId).toBe(1)
    })

    it('remembers the last few cards, not older ones', () => {
      const t = tracker()
      const ids = [1, 2, 3, 4, 1, 2]
      expect(
        run(
          t,
          ids.flatMap((id) => [seen(id), seen(id)])
        )
      ).toEqual([1, 2, 3, 4, 1, 2])
    })

    it('forgets them once the view clears', () => {
      const t = tracker()
      expect(run(t, [seen(1), seen(1), seen(2), seen(2)])).toEqual([1, 2])
      expect(run(t, [...Array<ScanOutcome>(8).fill(NONE), seen(1), seen(1)], 400)).toEqual([1])
      expect(t.heldBack()).toBeNull()
    })

    it('a new card held over the pile still counts, and stops holding back', () => {
      const t = tracker()
      run(t, [seen(1), seen(1), seen(2), seen(2), seen(1), seen(1)])
      expect(t.heldBack()?.cardId).toBe(1)
      expect(run(t, [seen(5), seen(5)], 1000)).toEqual([5])
      expect(t.heldBack()).toBeNull()
    })

    it('a card counted by photo (settle) is remembered too', () => {
      const t = createShowingTracker({
        stableFrames: 2,
        absentMs: 600,
        recentCards: 3,
        settleMs: 0
      })
      t.settle(0, draft(7))
      expect(run(t, [seen(2), seen(2), seen(7), seen(7), seen(7)], 100)).toEqual([2])
    })
  })

  it('reset forgets the card shown', () => {
    const t = createShowingTracker()
    expect(run(t, [seen(1), seen(1)])).toEqual([1])
    t.reset()
    expect(run(t, [seen(1), seen(1)], 300)).toEqual([1])
  })

  it('a single far-art frame right after a recognized one keeps the streak', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), FAR, seen(1)])).toEqual([1])
  })

  it('a far-art frame after an unsure one still keeps the streak', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), UNSURE, FAR, seen(1)])).toEqual([1])
  })

  it('two far-art frames in a row break the streak', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), FAR, FAR, seen(1)])).toEqual([])
  })

  it('far-art frames with nothing recognized just before are none, absence included', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const fars = Array<ScanOutcome>(7).fill(FAR)
    expect(run(t, [seen(1), seen(1), NONE, ...fars, seen(1), seen(1)])).toEqual([1, 1])
  })

  it('a plain none frame after a recognized one still breaks the streak', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), NONE, seen(1)])).toEqual([])
  })

  it('a held card flickering with far-art frames counts once', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const flicker = Array.from({ length: 30 }, (_, i) => (i % 2 ? FAR : seen(1)))
    expect(run(t, flicker)).toEqual([1])
  })

  it('a held card that keeps reading far art counts again only after a real absence', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const fars = Array<ScanOutcome>(8).fill(FAR)
    expect(run(t, [seen(1), seen(1), ...fars, seen(1), seen(1)])).toEqual([1, 1])
    expect(run(t, [seen(1), FAR, FAR, FAR, seen(1), seen(1)], 5000)).toEqual([])
  })

  it('after settle counts nothing until the view clears', () => {
    const t = createShowingTracker({ stableFrames: 1, absentMs: 100, settleMs: 5000 })
    t.settle(0)
    expect(t.push(10, seen(1))).toBeNull()
    t.push(20, NONE)
    t.push(130, NONE)
    expect(t.push(140, seen(1))?.cardId).toBe(1)
  })

  it('after settle for a counted card never counts that card again while it is held', () => {
    const t = createShowingTracker({ stableFrames: 1, absentMs: 100, settleMs: 500 })
    t.settle(0, draft(1))
    expect(t.push(600, seen(1))).toBeNull()
    expect(t.push(700, seen(1))).toBeNull()
    expect(t.push(800, seen(2))?.cardId).toBe(2)
  })

  it('after settle counts again once settleMs pass, for a view that never clears', () => {
    const t = createShowingTracker({ stableFrames: 1, absentMs: 100, settleMs: 500 })
    t.settle(0)
    expect(t.push(499, seen(2))).toBeNull()
    expect(t.push(500, seen(2))?.cardId).toBe(2)
  })
})

describe('One Piece twins', () => {
  const op = (cardId: number, setCode: string, name = 'Sanji'): ScanOutcome => ({
    kind: 'recognized',
    item: { ...draft(cardId), game: 'op', setCode, name }
  })

  it('counts an English and Japanese printing of one number as one card', () => {
    const t = createShowingTracker({ stableFrames: 2 })
    const counted = run(t, [
      op(1, 'OP11-051'),
      op(1, 'OP11-051'),
      op(2, 'OP11-051'),
      op(2, 'OP11-051'),
      op(1, 'OP11-051')
    ])
    expect(counted).toEqual([1])
  })

  it('counts a DON!! flickering to its Gold printing once, and another DON!! after it', () => {
    const t = createShowingTracker({ stableFrames: 2 })
    const counted = run(t, [
      op(1, 'DON!!', 'DON!! (Oden) (Gold)'),
      op(1, 'DON!!', 'DON!! (Oden) (Gold)'),
      op(2, 'DON!!', 'DON!! (Oden)'),
      op(2, 'DON!!', 'DON!! (Oden)'),
      op(3, 'DON!!', 'DON!! (Kaido)'),
      op(3, 'DON!!', 'DON!! (Kaido)')
    ])
    expect(counted).toEqual([1, 3])
  })
})

describe('Gem Pack versions', () => {
  // A Gem Pack numbers each version of a card as a card of its own (CBB7C 0801-0807): one card
  // held up reads as the stand-in version until the foil's pattern names its own.
  const version = (cardId: number): ScanPrinting => ({
    printingId: cardId * 100,
    cardId,
    name: 'Furret',
    frameType: 'pokemon',
    setName: 'Gem Pack Vol. 7',
    setCode: `CBB7C 080${cardId}`,
    rarity: 'Holofoil',
    language: 'zh-hans',
    price: null,
    imageIds: [cardId * 10]
  })
  const options = [version(1), version(2), version(5)]
  const gem = (cardId: number, flag: ScanDraft['flag'] = null): ScanOutcome => ({
    kind: 'recognized',
    item: {
      ...draft(cardId),
      game: 'pkm',
      name: 'Furret',
      setCode: `CBB7C 080${cardId}`,
      options,
      flag
    }
  })

  it('counts a card once as its stand-in version turns into the version its pattern names', () => {
    const t = createShowingTracker({ stableFrames: 2 })
    expect(
      run(t, [gem(1, 'pick-printing'), gem(1, 'pick-printing'), gem(2), gem(2), gem(1)])
    ).toEqual([1])
  })

  it('counts the named version first and the stand-in after it as one card', () => {
    const t = createShowingTracker({ stableFrames: 2 })
    expect(run(t, [gem(5), gem(5), gem(1, 'pick-printing'), gem(1, 'pick-printing')])).toEqual([5])
  })

  it('still counts another Pokémon card with a reprint among its options as its own', () => {
    const t = createShowingTracker({ stableFrames: 2 })
    const reprint = (cardId: number): ScanOutcome => ({
      kind: 'recognized',
      item: {
        ...draft(cardId),
        game: 'pkm',
        options: [
          { ...version(cardId), setName: `Set ${cardId}` },
          { ...version(9), setName: 'Set 9' }
        ]
      }
    })
    expect(run(t, [reprint(1), reprint(1), reprint(9), reprint(9)])).toEqual([1, 9])
  })
})

describe('a Normal and its Reverse Holofoil', () => {
  // One card, two printings: a pack often has a card and its reverse holo, shown one after the other.
  const printing = (printingId: number, rarity: string): ScanPrinting => ({
    printingId,
    cardId: 1,
    name: 'Pikachu',
    frameType: 'pokemon',
    setName: 'Mega Evolution',
    setCode: 'MEG 050',
    rarity,
    language: 'en',
    price: null,
    imageIds: [10]
  })
  const normal = printing(100, 'Normal')
  const reverse = printing(101, 'Reverse Holofoil')
  const read = (p: ScanPrinting, flag: ScanDraft['flag'] = null): ScanOutcome => ({
    kind: 'recognized',
    item: {
      ...draft(1),
      game: 'pkm',
      name: 'Pikachu',
      printingId: p.printingId,
      setCode: p.setCode,
      rarity: p.rarity,
      options: [normal, reverse],
      flag
    }
  })
  const tracker = (): ReturnType<typeof createShowingTracker> =>
    createShowingTracker({ stableFrames: 2, finishFrames: 4 })
  const printed = (t: ReturnType<typeof createShowingTracker>, outcomes: ScanOutcome[]) =>
    outcomes.flatMap((o, i) => {
      const d = t.push(i * 100, o)
      return d ? [d.rarity] : []
    })

  it('counts both when swapped one for the other without the view clearing', () => {
    expect(
      printed(tracker(), [...Array(3).fill(read(normal)), ...Array(4).fill(read(reverse))])
    ).toEqual(['Normal', 'Reverse Holofoil'])
  })

  it('counts a held card once when its finish reads the other way for a few frames', () => {
    const t = tracker()
    expect(
      printed(t, [
        read(normal),
        read(normal),
        read(reverse),
        read(reverse),
        read(reverse),
        read(normal)
      ])
    ).toEqual(['Normal'])
  })

  it('does not count the first finish again when the read flips back to it', () => {
    const t = tracker()
    const flips = [...Array(2).fill(read(normal)), ...Array(4).fill(read(reverse))]
    expect(printed(t, [...flips, ...Array(4).fill(read(normal))])).toEqual([
      'Normal',
      'Reverse Holofoil'
    ])
  })

  it('keeps a card whose finish is still to be checked one showing', () => {
    const t = tracker()
    expect(
      printed(t, [
        ...Array(2).fill(read(normal, 'check-rarity')),
        ...Array(6).fill(read(reverse, 'check-rarity'))
      ])
    ).toEqual(['Normal'])
  })
})
