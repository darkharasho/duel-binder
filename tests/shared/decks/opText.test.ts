import { describe, expect, it } from 'vitest'
import { OP_CODE, parseOpText, toOpText } from '../../../src/shared/decks/onepiece/text'
import type { DeckCard, DeckEntry } from '../../../src/shared/decks/types'

const op = (
  id: number,
  name: string,
  opCardType: string,
  opCost: number | null,
  opNumber: string | null
): DeckCard => ({
  id,
  name,
  type: opCardType,
  frameType: 'op',
  imageId: null,
  owned: 0,
  price: null,
  regionPrice: null,
  sourceId: null,
  code: null,
  opNumber,
  opCardType,
  opColors: ['Red'],
  opCost,
  opBlock: 1
})

describe('OP_CODE', () => {
  it('reads card numbers', () => {
    for (const c of ['OP13-086', 'ST01-001', 'EB01-012', 'P-001', 'PRB01-001'])
      expect(new RegExp(`^${OP_CODE.source}$`).test(c)).toBe(true)
  })
})

describe('parseOpText', () => {
  it('reads all five line forms', () => {
    const p = parseOpText(
      '4xOP13-086\n4x OP13-086 Sabo\n4 × OP13-086 - Sabo\nOP13-086 x4\nop13-086'
    )
    expect(p.sectioned).toBe(false)
    expect(p.skipped).toEqual([])
    expect(p.lines.map((l) => [l.qty, l.ref, l.section])).toEqual([
      [4, { opNumber: 'OP13-086', name: '' }, 'main'],
      [4, { opNumber: 'OP13-086', name: 'Sabo' }, 'main'],
      [4, { opNumber: 'OP13-086', name: 'Sabo' }, 'main'],
      [4, { opNumber: 'OP13-086', name: '' }, 'main'],
      [1, { opNumber: 'OP13-086', name: '' }, 'main']
    ])
    expect(p.lines.map((l) => l.line)).toEqual([1, 2, 3, 4, 5])
  })

  it('reads a name after the count in the count-last form', () => {
    const p = parseOpText('OP13-086 x4 Sabo\nOP13-086 x 2 - Sabo\nOP13-086 Xebec\nOP13-086 x4')
    expect(p.skipped).toEqual([])
    expect(p.lines.map((l) => [l.qty, l.ref])).toEqual([
      [4, { opNumber: 'OP13-086', name: 'Sabo' }],
      [2, { opNumber: 'OP13-086', name: 'Sabo' }],
      [1, { opNumber: 'OP13-086', name: 'Xebec' }],
      [4, { opNumber: 'OP13-086', name: '' }]
    ])
  })

  it('takes x, ×, * and · as separators', () => {
    for (const s of ['x', 'X', '×', '*', '·'])
      expect(parseOpText(`3${s}ST01-012`).lines[0]).toMatchObject({
        qty: 3,
        ref: { opNumber: 'ST01-012', name: '' }
      })
    expect(parseOpText('ST01-012 * 2').lines[0].qty).toBe(2)
  })

  it('ignores DON!!, blanks and comments, and skips the rest', () => {
    const p = parseOpText('10xDON!!\n\n# Leader\n// deck\n10 x don!! card\nhello\n0xOP01-016')
    expect(p.lines).toEqual([])
    expect(p.skipped).toEqual([
      { line: 6, raw: 'hello' },
      { line: 7, raw: '0xOP01-016' }
    ])
  })
})

describe('toOpText', () => {
  it('puts the Leader first, then the Deck in sort order', () => {
    const cards: Record<number, DeckCard> = {
      1: op(1, 'Monkey.D.Luffy', 'Leader', 5, 'OP01-001'),
      2: op(2, 'Nami', 'Character', 3, 'OP01-016'),
      3: op(3, 'Usopp', 'Character', 1, 'OP01-004'),
      4: op(4, 'No Number', 'Event', 1, null)
    }
    const entries: DeckEntry[] = [
      { section: 'main', card: 2, qty: 4 },
      { section: 'main', card: 4, qty: 2 },
      { section: 'main', card: 3, qty: 3 },
      { section: 'leader', card: 1, qty: 1 }
    ]
    const text = toOpText(entries, cards)
    expect(text).toBe('1xOP01-001\n3xOP01-004\n4xOP01-016\n2xNo Number')
    const back = parseOpText(text)
    expect(back.lines.slice(0, 3).map((l) => [l.qty, l.ref])).toEqual([
      [1, { opNumber: 'OP01-001', name: '' }],
      [3, { opNumber: 'OP01-004', name: '' }],
      [4, { opNumber: 'OP01-016', name: '' }]
    ])
  })

  it('merges English and Japanese twins into one line per number', () => {
    const cards: Record<number, DeckCard> = {
      1: op(1, 'Monkey.D.Luffy', 'Leader', 5, 'OP01-001'),
      2: op(2, 'Nami', 'Character', 3, 'OP01-016'),
      3: op(3, 'ナミ', 'Character', 3, 'OP01-016'),
      4: op(4, 'No Number', 'Event', 1, null),
      5: op(5, 'No Number', 'Event', 1, null)
    }
    const entries: DeckEntry[] = [
      { section: 'leader', card: 1, qty: 1 },
      { section: 'main', card: 2, qty: 2 },
      { section: 'main', card: 3, qty: 2 },
      { section: 'main', card: 4, qty: 1 },
      { section: 'main', card: 5, qty: 1 }
    ]
    expect(toOpText(entries, cards)).toBe('1xOP01-001\n4xOP01-016\n1xNo Number\n1xNo Number')
  })
})
