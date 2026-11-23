import { describe, expect, it } from 'vitest'
import fixtures from '../../fixtures/decks/op/oplay-codes.json'
import {
  OplayError,
  decodeOplay,
  encodeOplayV2,
  oplayLink,
  type OplayDeck
} from '../../../src/shared/decks/onepiece/oplay'
import { parseOpList } from '../../../src/shared/decks/onepiece/text'

// Every code below was made by OPlay's own encoder (copied from oplaytcg.com's deck builder bundle).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const deckOf = (f: (typeof fixtures)[number]): OplayDeck => ({
  leader: f.leader,
  entries: f.entries
})

/** The same code with a different check character. */
const badCheck = (code: string): string => {
  const last = code[code.length - 1]
  const other = ALPHABET[(ALPHABET.indexOf(last) + 1) % 64]
  return code.slice(0, -1) + other
}

describe('decodeOplay', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('decodes OPlay’s code: %s', (_, f) => {
    expect(decodeOplay(f.code)).toEqual(deckOf(f))
  })

  it('throws OplayError on a changed check character', () => {
    for (const f of fixtures) expect(() => decodeOplay(badCheck(f.code))).toThrow(OplayError)
  })

  it('throws OplayError on a malformed payload', () => {
    expect(() => decodeOplay('2')).toThrow(OplayError)
    expect(() => decodeOplay('2A')).toThrow(OplayError)
    expect(() => decodeOplay('2gB*EbA3')).toThrow(OplayError)
    expect(() => decodeOplay('3abc')).toThrow(OplayError)
    // a payload cut short: the count says more entries than there are bits for
    const cut = fixtures[0].code.slice(1, 12)
    let t = 7
    for (const ch of cut) t = (31 * t + ch.charCodeAt(0)) % 4093
    expect(() => decodeOplay('2' + cut + ALPHABET[t % 64])).toThrow(OplayError)
  })

  it('decodes a v1 code', () => {
    // '1' + base64url('OP01-060|4xOP01-016,4xST01-012,2xEB01-003'), read the same by OPlay's decoder
    expect(decodeOplay('1T1AwMS0wNjB8NHhPUDAxLTAxNiw0eFNUMDEtMDEyLDJ4RUIwMS0wMDM')).toEqual({
      leader: 'OP01-060',
      entries: [
        { code: 'OP01-016', qty: 4 },
        { code: 'ST01-012', qty: 4 },
        { code: 'EB01-003', qty: 2 }
      ]
    })
  })
})

describe('encodeOplayV2', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))(
    'matches OPlay’s code byte for byte: %s',
    (_, f) => {
      const deck = decodeOplay(f.code)
      expect(decodeOplay(encodeOplayV2(deck))).toEqual(deck)
      expect(encodeOplayV2(deck)).toBe(f.code)
    }
  )

  it('sorts entries by code ascending', () => {
    const deck: OplayDeck = {
      leader: 'OP01-001',
      entries: [
        { code: 'ST01-012', qty: 4 },
        { code: 'OP01-016', qty: 4 },
        { code: 'EB01-003', qty: 1 }
      ]
    }
    expect(decodeOplay(encodeOplayV2(deck)).entries.map((e) => e.code)).toEqual([
      'EB01-003',
      'OP01-016',
      'ST01-012'
    ])
  })
})

describe('oplayLink', () => {
  it('builds the share link', () => {
    expect(oplayLink('2AgAQQyAABAG')).toBe('https://oplaytcg.com/en/deck-builder?d=2AgAQQyAABAG')
  })
})

describe('parseOpList', () => {
  const f = fixtures[0]

  it('reads a ?d= share link', () => {
    const list = parseOpList(`  ${oplayLink(f.code)}  `)
    expect(list.sectioned).toBe(true)
    expect(list.skipped).toEqual([])
    expect(list.lines[0]).toMatchObject({
      section: 'leader',
      qty: 1,
      ref: { opNumber: 'OP01-001', name: '' }
    })
    expect(list.lines.slice(1).map((l) => [l.section, l.qty, l.ref])).toEqual(
      f.entries.map((e) => ['main', e.qty, { opNumber: e.code, name: '' }])
    )
    expect(list.lines.slice(1).reduce((s, l) => s + l.qty, 0)).toBe(50)
  })

  it('reads a bare deck code', () => {
    const list = parseOpList(fixtures[1].code)
    expect(list.sectioned).toBe(true)
    expect(list.lines[0].ref).toEqual({ opNumber: 'ST01-001', name: '' })
    expect(list.lines).toHaveLength(fixtures[1].entries.length + 1)
  })

  it('reads a leader-less code without a leader line', () => {
    const list = parseOpList(fixtures[fixtures.length - 1].code)
    expect(list.lines.map((l) => l.section)).toEqual(['main', 'main'])
  })

  it('throws on a ?deck= link to a deck saved on OPlay', () => {
    expect(() => parseOpList('https://oplaytcg.com/en/deck-builder?deck=123')).toThrow(
      new OplayError(
        'That link points to a deck saved on OPlay. Open it there and copy its deck code or share link instead.'
      )
    )
  })

  it('still parses a plain list as text', () => {
    const list = parseOpList('1xOP01-001\n4xOP01-016\n4x OP01-025 Zoro')
    expect(list.sectioned).toBe(false)
    expect(list.lines.map((l) => [l.section, l.qty, l.ref])).toEqual([
      ['main', 1, { opNumber: 'OP01-001', name: '' }],
      ['main', 4, { opNumber: 'OP01-016', name: '' }],
      ['main', 4, { opNumber: 'OP01-025', name: 'Zoro' }]
    ])
  })

  it('reads a single card number as text, not as a code', () => {
    expect(parseOpList('OP01-016').lines[0].ref).toEqual({ opNumber: 'OP01-016', name: '' })
  })
})
