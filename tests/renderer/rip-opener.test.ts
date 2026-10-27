import { initialOpener, openerReducer, type OpenerState } from '@/features/rip/opener'
import type { RipCard } from '../../src/shared/rip/types'

const card = (rarity: string, slot: number): RipCard => ({
  pkey: `k${slot}`,
  cardId: slot,
  name: `Card ${slot}`,
  setCode: `LOB-EN00${slot}`,
  rarity,
  variant: null,
  frameType: 'normal',
  imageId: slot,
  slot
})

const pack = [card('Common', 0), card('Common', 1), card('Super Rare', 2)]
const loaded = (packCount = 3): OpenerState =>
  openerReducer(initialOpener(packCount), { type: 'packLoaded', cards: pack })

describe('openerReducer', () => {
  it('starts loading the first pack', () => {
    expect(initialOpener(5)).toEqual({
      packCount: 5,
      packIndex: 0,
      cards: null,
      flipped: 0,
      loading: true,
      done: false,
      opened: []
    })
  })

  it('packLoaded shows the pack face down and records it as opened', () => {
    const s = loaded()
    expect(s.loading).toBe(false)
    expect(s.flipped).toBe(0)
    expect(s.cards).toEqual(pack)
    expect(s.opened).toEqual([pack])
  })

  it('packLoaded sorts stably by rarity, best last, keeping slots', () => {
    const cards = [
      card('Common', 0),
      card('Super Rare', 1),
      card('Common', 2),
      card('Rare', 3),
      card('Common', 4)
    ]
    const s = openerReducer(initialOpener(1), { type: 'packLoaded', cards })
    expect(s.cards!.map((c) => c.slot)).toEqual([0, 2, 4, 3, 1])
    expect(s.opened[0].map((c) => c.slot)).toEqual([0, 2, 4, 3, 1])
  })

  it('flip increments flipped up to cards.length', () => {
    let s = loaded()
    s = openerReducer(s, { type: 'flip' })
    expect(s.flipped).toBe(1)
    s = openerReducer(openerReducer(openerReducer(s, { type: 'flip' }), { type: 'flip' }), {
      type: 'flip'
    })
    expect(s.flipped).toBe(3)
  })

  it('flip is ignored while loading', () => {
    const s = initialOpener(3)
    expect(openerReducer(s, { type: 'flip' })).toBe(s)
    expect(openerReducer(s, { type: 'skip' })).toBe(s)
  })

  it('skip flips the whole pack', () => {
    expect(openerReducer(loaded(), { type: 'skip' }).flipped).toBe(3)
  })

  it('next before all flipped is ignored', () => {
    const s = openerReducer(loaded(), { type: 'flip' })
    expect(openerReducer(s, { type: 'next' })).toBe(s)
  })

  it('next after all flipped loads the next pack', () => {
    const s = openerReducer(openerReducer(loaded(), { type: 'skip' }), { type: 'next' })
    expect(s).toMatchObject({ packIndex: 1, cards: null, flipped: 0, loading: true, done: false })
    expect(s.opened).toEqual([pack])
  })

  it('next is ignored while the next pack is loading', () => {
    const s = openerReducer(openerReducer(loaded(), { type: 'skip' }), { type: 'next' })
    expect(openerReducer(s, { type: 'next' })).toBe(s)
  })

  it('next on the last pack is done', () => {
    const s = openerReducer(openerReducer(loaded(1), { type: 'skip' }), { type: 'next' })
    expect(s.done).toBe(true)
    expect(s.loading).toBe(false)
  })

  it('never opens past packCount', () => {
    const last: OpenerState = { ...loaded(3), packIndex: 2, flipped: 3 }
    const s = openerReducer(last, { type: 'next' })
    expect(s).toMatchObject({ packIndex: 2, done: true, loading: false })
    expect(openerReducer(s, { type: 'next' })).toBe(s)
    expect(openerReducer(s, { type: 'packLoaded', cards: pack })).toBe(s)
  })

  it('packLoaded is ignored when no pack is loading', () => {
    const s = loaded()
    expect(openerReducer(s, { type: 'packLoaded', cards: pack })).toBe(s)
  })
})
