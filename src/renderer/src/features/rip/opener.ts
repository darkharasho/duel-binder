import { ripRank } from '../../../../shared/rip/rarity'
import type { RipCard } from '../../../../shared/rip/types'

/** Where a rip session's opener is: which pack is showing and how many of its cards are face up. */
export interface OpenerState {
  packCount: number
  /** 0-based index of the pack showing (or loading). */
  packIndex: number
  /** The showing pack in flip order, or null while it loads. */
  cards: RipCard[] | null
  flipped: number
  loading: boolean
  done: boolean
  /** Every pack opened so far, in the order opened; each in flip order. */
  opened: RipCard[][]
}

export type OpenerEvent =
  { type: 'packLoaded'; cards: RipCard[] } | { type: 'flip' } | { type: 'skip' } | { type: 'next' }

export function initialOpener(packCount: number): OpenerState {
  return {
    packCount,
    packIndex: 0,
    cards: null,
    flipped: 0,
    loading: true,
    done: false,
    opened: []
  }
}

/** Least rare first, so the best card flips last. Stable, so equal rarities keep slot order. */
const flipOrder = (cards: RipCard[]): RipCard[] =>
  [...cards].sort((a, b) => ripRank(a.rarity) - ripRank(b.rarity))

export function openerReducer(s: OpenerState, e: OpenerEvent): OpenerState {
  if (s.done) return s
  switch (e.type) {
    case 'packLoaded': {
      if (!s.loading) return s
      const cards = flipOrder(e.cards)
      return { ...s, cards, flipped: 0, loading: false, opened: [...s.opened, cards] }
    }
    case 'flip':
      if (s.loading || !s.cards || s.flipped >= s.cards.length) return s
      return { ...s, flipped: s.flipped + 1 }
    case 'skip':
      if (s.loading || !s.cards || s.flipped >= s.cards.length) return s
      return { ...s, flipped: s.cards.length }
    case 'next':
      if (s.loading || !s.cards || s.flipped < s.cards.length) return s
      if (s.packIndex >= s.packCount - 1) return { ...s, done: true, loading: false }
      return { ...s, packIndex: s.packIndex + 1, cards: null, flipped: 0, loading: true }
  }
}
