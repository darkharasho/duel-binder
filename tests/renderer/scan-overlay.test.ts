import { describe, expect, it } from 'vitest'
import {
  FADE_MS,
  HIT_MS,
  NORMAL_MS,
  NO_OVERLAY,
  pullOf,
  pushPull,
  tickOverlay,
  type Pull
} from '@/features/scan/window/overlay'
import type { ScanDraft } from '@/features/scan/resolve'
import type { ScanPrinting } from '@shared/scan/types'

const printing = (over: Partial<ScanPrinting> = {}): ScanPrinting => ({
  printingId: 1,
  cardId: 10,
  name: 'Dark Magician',
  frameType: 'normal',
  setName: 'Legend of Blue Eyes',
  setCode: 'LOB-005',
  rarity: 'Ultra Rare',
  language: 'en',
  price: 12.5,
  imageIds: [46986414],
  ...over
})

const draft = (over: Partial<ScanDraft> = {}, opt: Partial<ScanPrinting> = {}): ScanDraft => ({
  cardId: 10,
  name: 'Dark Magician',
  imageId: 46986414,
  printingId: 1,
  setCode: 'LOB-005',
  rarity: 'Ultra Rare',
  options: [printing(opt)],
  flag: null,
  via: 'code',
  ...over
})

const pull = (key: number, hit = false): Pull => ({
  key,
  name: `Card ${key}`,
  imageId: key,
  setCode: null,
  setName: null,
  rarity: null,
  price: null,
  range: null,
  raw: false,
  hit
})

describe('pullOf', () => {
  it('builds the full pull for a certain draft below the hit price', () => {
    expect(pullOf(draft(), 20, 7)).toEqual({
      key: 7,
      name: 'Dark Magician',
      imageId: 46986414,
      setCode: 'LOB-005',
      setName: 'Legend of Blue Eyes',
      rarity: 'Ultra Rare',
      price: 12.5,
      range: null,
      raw: false,
      hit: false
    })
  })

  it('is a hit at exactly the hit price', () => {
    expect(pullOf(draft({}, { price: 20 }), 20, 1).hit).toBe(true)
  })

  it('shows the drafted price with the range of its printings under it for a pick-printing draft', () => {
    const d = draft({
      flag: 'pick-printing',
      printingId: 1,
      options: [
        printing({ price: 50 }),
        printing({ printingId: 2, price: 2 }),
        printing({ printingId: 3, language: 'de', price: null })
      ]
    })
    expect(pullOf(d, 20, 1)).toMatchObject({
      name: 'Dark Magician',
      setCode: null,
      setName: null,
      rarity: null,
      price: 50,
      range: { low: 2, high: 50 },
      hit: true
    })
  })

  it('pkm pick-printing pull shows range and is never a hit', () => {
    const d = draft({
      game: 'pkm',
      flag: 'pick-printing',
      printingId: 2,
      options: [printing({ printingId: 2, price: 2 }), printing({ printingId: 3, price: 45 })]
    })
    // The placeholder printing's price isn't the card's: only the range shows.
    expect(pullOf(d, 20, 1)).toMatchObject({
      price: null,
      range: { low: 2, high: 45 },
      raw: false,
      hit: false
    })
    expect(pullOf(draft({ ...d, printingId: 3 }), 20, 1).hit).toBe(false)
  })

  it('a best guess is marked and is never a hit; a certain pull has no mark', () => {
    expect(pullOf(draft({ guess: true }), 1, 1)).toMatchObject({ guess: true, hit: false })
    expect('guess' in pullOf(draft(), 1, 1)).toBe(false)
  })

  it('slab pull shows Raw and can be a hit', () => {
    const d = draft({ game: 'pkm', slab: true }, { price: 120 })
    expect(pullOf(d, 20, 1)).toMatchObject({ price: 120, raw: true, hit: true })
    expect(pullOf(draft({ game: 'pkm' }, { price: 120 }), 20, 1).raw).toBe(false)
  })

  it('shows no range for a pick-printing draft whose priced printings agree', () => {
    const d = draft({ flag: 'pick-printing' }, { price: 4 })
    expect(pullOf(d, 1, 1)).toMatchObject({ price: 4, range: null, hit: true })
  })

  it('shows no price for a pick-printing draft with no priced printing', () => {
    const d = draft({ flag: 'pick-printing' }, { price: null })
    expect(pullOf(d, 20, 1)).toMatchObject({ price: null, range: null })
  })

  it('shows the range but not the price when the drafted printing has none', () => {
    const d = draft({
      flag: 'pick-printing',
      options: [
        printing({ price: null }),
        printing({ printingId: 2, price: 3 }),
        printing({ printingId: 3, price: 9 })
      ]
    })
    expect(pullOf(d, 20, 1)).toMatchObject({ price: null, range: { low: 3, high: 9 } })
  })

  it('gives no range for a certain draft', () => {
    const d = draft({ options: [printing(), printing({ printingId: 2, price: 99 })] })
    expect(pullOf(d, 200, 1).range).toBeNull()
  })

  it('shows the picked rarity and its printing price for a check-rarity draft', () => {
    const d = draft({
      flag: 'check-rarity',
      printingId: 2,
      rarity: 'Secret Rare',
      options: [printing(), printing({ printingId: 2, rarity: 'Secret Rare', price: 30 })]
    })
    expect(pullOf(d, 20, 1)).toMatchObject({
      rarity: 'Secret Rare',
      price: 30,
      range: { low: 12.5, high: 30 },
      hit: true
    })
  })

  it('treats an option with no price key as no price', () => {
    const old = printing() as Partial<ScanPrinting>
    delete old.price
    const p = pullOf(draft({ options: [old as ScanPrinting] }), 20, 1)
    expect(p.price).toBeNull()
    expect(p.hit).toBe(false)
  })
})

describe('overlay state', () => {
  it('has a fade shorter than a normal pull', () => {
    expect(FADE_MS).toBeLessThan(NORMAL_MS)
  })

  it('lets a normal pull replace a normal pull at once', () => {
    const a = pushPull(NO_OVERLAY, pull(1), 0)
    expect(a).toEqual({ showing: pull(1), until: NORMAL_MS, pending: null })
    const b = pushPull(a, pull(2), 1000)
    expect(b).toEqual({ showing: pull(2), until: 1000 + NORMAL_MS, pending: null })
  })

  it('makes a normal pull wait behind a hit, then show it for NORMAL_MS', () => {
    const a = pushPull(NO_OVERLAY, pull(1, true), 0)
    expect(a.until).toBe(HIT_MS)
    const b = pushPull(a, pull(2), 1000)
    expect(b.showing).toEqual(pull(1, true))
    expect(b.pending).toEqual(pull(2))
    expect(tickOverlay(b, HIT_MS - 1)).toBe(b)
    // The hit fades out first; the waiting pull only shows after the gap.
    const gap = tickOverlay(b, HIT_MS)
    expect(gap).toEqual({ showing: null, until: HIT_MS + FADE_MS, pending: pull(2) })
    expect(tickOverlay(gap, HIT_MS + FADE_MS - 1)).toBe(gap)
    expect(tickOverlay(gap, HIT_MS + FADE_MS)).toEqual({
      showing: pull(2),
      until: HIT_MS + FADE_MS + NORMAL_MS,
      pending: null
    })
  })

  it('shows a pull pushed during the fade gap at once', () => {
    const gap = tickOverlay(pushPull(pushPull(NO_OVERLAY, pull(1, true), 0), pull(2), 1000), HIT_MS)
    const s = pushPull(gap, pull(3), HIT_MS + 100)
    expect(s).toEqual({ showing: pull(3), until: HIT_MS + 100 + NORMAL_MS, pending: null })
  })

  it('keeps only the latest of two normals waiting behind a hit', () => {
    let s = pushPull(NO_OVERLAY, pull(1, true), 0)
    s = pushPull(s, pull(2), 1000)
    s = pushPull(s, pull(3), 2000)
    expect(s.pending).toEqual(pull(3))
  })

  it('lets a hit replace a hit and keeps the waiting normal', () => {
    let s = pushPull(NO_OVERLAY, pull(1, true), 0)
    s = pushPull(s, pull(2), 1000)
    s = pushPull(s, pull(3, true), 2000)
    expect(s).toEqual({ showing: pull(3, true), until: 2000 + HIT_MS, pending: pull(2) })
  })

  it('lets a hit replace a showing normal', () => {
    const s = pushPull(pushPull(NO_OVERLAY, pull(1), 0), pull(2, true), 500)
    expect(s).toEqual({ showing: pull(2, true), until: 500 + HIT_MS, pending: null })
  })

  it('clears at until when nothing waits', () => {
    const s = pushPull(NO_OVERLAY, pull(1), 0)
    expect(tickOverlay(s, NORMAL_MS)).toEqual(NO_OVERLAY)
  })
})
