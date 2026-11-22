import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detectYgoList,
  parseYgoList,
  toYdk,
  toYdke,
  toYgoText
} from '../../../src/shared/decks/ygo/lists'
import type { ParsedList } from '../../../src/shared/decks/ygo/lists'
import { sortEntries } from '../../../src/shared/decks/sort'
import type { DeckCard, DeckEntry } from '../../../src/shared/decks/types'

const fx = (n: string): string =>
  readFileSync(join(__dirname, '../../fixtures/decks/ygo', n), 'utf8')

function totals(p: ParsedList): Record<string, number> {
  const t: Record<string, number> = { main: 0, extra: 0, side: 0 }
  for (const l of p.lines) t[l.section] += l.qty
  return t
}
function keyed(p: ParsedList): string[] {
  return p.lines.map((l) => `${l.section}:${JSON.stringify(l.ref)}:${l.qty}`).sort()
}

const card = (id: number, name: string, type: string): DeckCard => ({
  id,
  name,
  type,
  frameType: 'normal',
  imageId: null,
  owned: 0,
  price: null,
  regionPrice: null
})
const CARDS: Record<number, DeckCard> = {
  1: card(1, 'Ash Blossom & Joyous Spring', 'Tuner Monster'),
  2: card(2, 'Called by the Grave', 'Spell Card'),
  3: card(3, 'Solemn Judgment', 'Trap Card'),
  4: card(4, 'Accesscode Talker', 'Link Monster')
}

describe('ygo lists', () => {
  it('reads each fixture', () => {
    for (const n of ['yugiohprodeck.ydk', 'edopro.ydk', 'ydke.txt']) {
      const p = parseYgoList(fx(n))
      expect(totals(p), n).toEqual({ main: 40, extra: 15, side: 15 })
      expect(p.skipped, n).toEqual([])
    }
    const d = parseYgoList(fx('paste-discord.txt'))
    expect(totals(d)).toEqual({ main: 40, extra: 15, side: 15 })
    expect(d.skipped).toEqual([])
    const h = parseYgoList(fx('paste-headers.txt'))
    expect(totals(h)).toEqual({ main: 5, extra: 2, side: 3 })
    expect(h.skipped).toEqual([])
  })

  it('keeps the alternate-art passcode and collapses repeats', () => {
    const p = parseYgoList(fx('yugiohprodeck.ydk'))
    expect(p.lines.find((l) => 'passcode' in l.ref && l.ref.passcode === 36996508)).toMatchObject({
      section: 'main',
      qty: 1
    })
    const dm = p.lines.filter((l) => 'passcode' in l.ref && l.ref.passcode === 46986416)
    expect(dm).toHaveLength(1)
    expect(dm[0].qty).toBe(2)
  })

  it('ydk and ydke fixtures hold the same deck', () => {
    expect(keyed(parseYgoList(fx('ydke.txt')))).toEqual(
      keyed(parseYgoList(fx('yugiohprodeck.ydk')))
    )
    expect(keyed(parseYgoList(fx('edopro.ydk')))).toEqual(
      keyed(parseYgoList(fx('yugiohprodeck.ydk')))
    )
  })

  it('decodes a hand-built ydke string', () => {
    const enc = (ids: number[]): string => {
      const b = Buffer.alloc(ids.length * 4)
      ids.forEach((id, i) => b.writeUInt32LE(id, i * 4))
      return b.toString('base64')
    }
    const p = parseYgoList(
      `ydke://${enc([14558128, 14558128, 24224830])}!${enc([86066372])}!${enc([])}!`
    )
    expect(p.skipped).toEqual([])
    expect(keyed(p)).toEqual(
      [
        'extra:{"passcode":86066372}:1',
        'main:{"passcode":14558128}:2',
        'main:{"passcode":24224830}:1'
      ].sort()
    )
  })

  it('treats a malformed ydke section as one skipped line', () => {
    const good = Buffer.from([1, 0, 0, 0]).toString('base64')
    const p = parseYgoList(`ydke://${good}!@@@!!`)
    expect(p.lines.map((l) => l.section)).toEqual(['main'])
    expect(p.skipped).toHaveLength(1)
    expect(p.skipped[0].raw).toBe('@@@')
  })

  it('skips a non-numeric ydk line but not comments', () => {
    const p = parseYgoList('#created by Player\n#main\n123\nbanana\n#extra\n!side\n')
    expect(p.lines).toHaveLength(1)
    expect(p.skipped).toEqual([{ line: 4, raw: 'banana' }])
  })

  it('round-trips ydk and ydke', () => {
    const e: DeckEntry[] = [
      { section: 'main', card: 14558128, qty: 3 },
      { section: 'main', card: 24224830, qty: 1 },
      { section: 'extra', card: 86066372, qty: 2 },
      { section: 'side', card: 41420027, qty: 3 }
    ]
    const want = [
      'extra:{"passcode":86066372}:2',
      'main:{"passcode":14558128}:3',
      'main:{"passcode":24224830}:1',
      'side:{"passcode":41420027}:3'
    ]
    expect(keyed(parseYgoList(toYdk(e)))).toEqual(want)
    expect(keyed(parseYgoList(toYdke(e)))).toEqual(want)
    expect(
      toYdk(e).startsWith(
        '#created by Duel Binder\n#main\n14558128\n14558128\n14558128\n24224830\n#extra\n86066372\n86066372\n!side\n'
      )
    ).toBe(true)
    expect(toYdke(e).startsWith('ydke://')).toBe(true)
    expect(toYdke(e).endsWith('!')).toBe(true)
    expect(toYdke([])).toBe('ydke://!!!')
  })

  it('reads a messy paste', () => {
    const d = parseYgoList(fx('paste-discord.txt'))
    const find = (n: string) => d.lines.find((l) => 'name' in l.ref && l.ref.name === n)
    expect(find('Maxx "C"')).toMatchObject({ section: 'main', qty: 3 })
    expect(find('Fallen of Albaz')?.qty).toBe(3)
    expect(find('Dark Magician [LOB-005]')).toBeUndefined()
    expect(find('Dark Magician')?.qty).toBe(2)
    expect(find('Magician of Black Chaos')?.qty).toBe(2)
    expect(find('Apollousa, Bow of the Goddess')?.section).toBe('extra')
    expect(d.lines.find((l) => 'passcode' in l.ref)).toMatchObject({
      ref: { passcode: 36996508 },
      qty: 1
    })
    const h = parseYgoList(fx('paste-headers.txt'))
    expect(
      h.lines.find((l) => 'name' in l.ref && l.ref.name === 'Apollousa, Bow of the Goddess')
    ).toMatchObject({ section: 'extra', qty: 1 })
    expect(h.lines.find((l) => 'name' in l.ref && l.ref.name === 'Solemn Judgment')?.section).toBe(
      'side'
    )
  })

  it('reads CRLF the same as LF', () => {
    const lf = fx('paste-discord.txt')
    const a = parseYgoList(lf)
    const b = parseYgoList(lf.replace(/\n/g, '\r\n'))
    expect(b.lines.map((l) => ({ ...l, raw: l.raw.trimEnd() }))).toEqual(a.lines)
    expect(b.skipped).toEqual([])
    const y = fx('yugiohprodeck.ydk')
    expect(keyed(parseYgoList(y.replace(/\n/g, '\r\n')))).toEqual(keyed(parseYgoList(y)))
  })

  it('keeps an unknown line as a name, not dropped', () => {
    const p = parseYgoList('lorem ipsum')
    expect(p.skipped).toEqual([])
    expect(p.lines).toHaveLength(1)
    expect(p.lines[0]).toMatchObject({
      section: 'main',
      qty: 1,
      ref: { name: 'lorem ipsum' },
      line: 1
    })
  })

  it('skips only qty 0 or punctuation-only text lines', () => {
    const p = parseYgoList('0 Pot of Greed\n---\n2 Dark Hole')
    expect(p.lines).toHaveLength(1)
    expect(p.skipped.map((s) => s.raw)).toEqual(['0 Pot of Greed', '---'])
  })

  it('a header with no cards switches the section', () => {
    const p = parseYgoList('Side Deck (1)\n1 Ash Blossom & Joyous Spring')
    expect(p.lines[0].section).toBe('side')
    expect(p.lines).toHaveLength(1)
  })

  it('reads #id as a passcode', () => {
    const p = parseYgoList('2 #14558128')
    expect(p.lines[0]).toMatchObject({ qty: 2, ref: { passcode: 14558128 } })
  })

  it('reads bare passcode lines (a list without #main) as one copy each, folded', () => {
    const p = parseYgoList('14558127\n14558127\n55144522\n3 Pot of Greed')
    expect(keyed(p)).toEqual([
      'main:{"name":"Pot of Greed"}:3',
      'main:{"passcode":14558127}:2',
      'main:{"passcode":55144522}:1'
    ])
    expect(p.skipped).toEqual([])
    // Too short or too long for a passcode: still read as text, not a passcode.
    expect(parseYgoList('1234').lines[0].ref).toEqual({ name: '1234' })
    expect(parseYgoList('12345678901').lines[0].ref).toEqual({ name: '12345678901' })
  })

  it('says whether the list named its sections', () => {
    expect(parseYgoList('3 Pot of Greed\n1 Accesscode Talker').sectioned).toBe(false)
    expect(parseYgoList('Main Deck\n3 Pot of Greed').sectioned).toBe(true)
    expect(parseYgoList(fx('yugiohprodeck.ydk')).sectioned).toBe(true)
    expect(parseYgoList('ydke://!!!').sectioned).toBe(true)
  })

  it('detects the format', () => {
    expect(detectYgoList(fx('yugiohprodeck.ydk'))).toBe('ydk')
    expect(detectYgoList(fx('edopro.ydk'))).toBe('ydk')
    expect(detectYgoList(fx('ydke.txt'))).toBe('ydke')
    expect(detectYgoList(fx('paste-discord.txt'))).toBe('text')
    expect(detectYgoList(fx('paste-headers.txt'))).toBe('text')
  })

  it('exports text exactly', () => {
    const e: DeckEntry[] = [
      { section: 'side', card: 3, qty: 1 },
      { section: 'main', card: 2, qty: 2 },
      { section: 'main', card: 1, qty: 3 },
      { section: 'main', card: 1, printing: 'p2', qty: 1 },
      { section: 'extra', card: 4, qty: 1 },
      { section: 'extra', card: 99, qty: 2 }
    ]
    expect(toYgoText(e, CARDS)).toBe(
      'Main Deck (6)\n4 Ash Blossom & Joyous Spring\n2 Called by the Grave\n\n' +
        'Extra Deck (3)\n1 Accesscode Talker\n2 #99\n\n' +
        'Side Deck (1)\n1 Solemn Judgment'
    )
    expect(toYgoText([], CARDS)).toBe('')
  })

  it('exported text parses back', () => {
    const e: DeckEntry[] = [
      { section: 'main', card: 1, qty: 3 },
      { section: 'extra', card: 99, qty: 2 }
    ]
    const p = parseYgoList(toYgoText(e, CARDS))
    expect(keyed(p)).toEqual([
      'extra:{"passcode":99}:2',
      'main:{"name":"Ash Blossom & Joyous Spring"}:3'
    ])
  })
})

describe('sortEntries', () => {
  it('puts monsters, then spells, then traps, then unknown', () => {
    const e: DeckEntry[] = [
      { section: 'main', card: 99, qty: 1 },
      { section: 'main', card: 3, qty: 1 },
      { section: 'main', card: 2, qty: 1 },
      { section: 'main', card: 1, qty: 1 }
    ]
    expect(sortEntries('ygo', e, CARDS).map((x) => x.card)).toEqual([1, 2, 3, 99])
    expect(e.map((x) => x.card)).toEqual([99, 3, 2, 1])
  })
  it('breaks ties by name, then id', () => {
    const cards = {
      5: card(5, 'B', 'Effect Monster'),
      6: card(6, 'A', 'Effect Monster'),
      7: card(7, 'A', 'Effect Monster')
    }
    const e: DeckEntry[] = [5, 7, 6].map((c) => ({ section: 'main' as const, card: c, qty: 1 }))
    expect(sortEntries('ygo', e, cards).map((x) => x.card)).toEqual([6, 7, 5])
  })
})
