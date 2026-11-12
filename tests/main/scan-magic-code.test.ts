import { describe, expect, test } from 'vitest'
import { frameMagicCode, normalizeMagicCode } from '../../src/shared/scan/magicCode'
import { prefixSuggestions } from '../../src/shared/scan/onePieceNumber'
import { numberPrefixes } from '../../src/main/repo/scan'
import { setActiveGame } from '../../src/main/cloud/activeGame'
import { seededDb } from './helpers'
import { seedOnePiece } from '../fixtures/onePiece'

describe('normalizeMagicCode', () => {
  test.each([
    ['mh3 123', 'MH3 123'],
    ['MH3-0123', 'MH3 123'],
    ['mh3 #123', 'MH3 123'],
    ['mh3/123', 'MH3 123'],
    [' mh3  0123 ', 'MH3 123'],
    ['neo 123a', 'NEO 123a'],
    ['NEO 123A', 'NEO 123a'],
    ['9ed 213★', '9ED 213★'],
    ['plst xln-217', 'PLST XLN-217'],
    ['PLST XLN-0217', 'PLST XLN-217'],
    ['lea 0', 'LEA 0'],
    // As 2015-2022 cards print it, with the set's card count.
    ['xln 078/279', 'XLN 78'],
    ['xln 78 / 279', 'XLN 78'],
    // Numbers that aren't a number and a suffix are taken as typed.
    ['8ed s1', '8ED S1'],
    ['prwk a01', 'PRWK A01'],
    ['por 38†', 'POR 38†'],
    ['soi 265†a', 'SOI 265†a'],
    ['7ed 130★s', '7ED 130★s'],
    ['wc97 jk139sb', 'WC97 JK139SB'],
    ['olgc 2018na', 'OLGC 2018na'],
    ['plst jud-119†', 'PLST JUD-119†'],
    ['plst td0-a80', 'PLST TD0-A80'],
    // A year is no List set: its number keeps its zeros.
    ['pwcs 2024-05', 'PWCS 2024-05'],
    ['wc97 00', 'WC97 00']
  ])('%j reads as %s', (t, want) => expect(normalizeMagicCode(t)).toBe(want))
  test.each(['mh3123', 'mh3', '', '123'])('%j is not a code', (t) =>
    expect(normalizeMagicCode(t)).toBeNull()
  )
})

describe('prefixSuggestions with a space', () => {
  const P = ['MH1', 'MH2', 'MH3', 'NEO']
  test('suggests set codes until the set is typed out', () => {
    expect(prefixSuggestions('mh', P, 8, ' ')).toEqual(['MH1 ', 'MH2 ', 'MH3 '])
    expect(prefixSuggestions('mh3 ', P, 8, ' ')).toEqual([])
    expect(prefixSuggestions('mh3-', P, 8, ' ')).toEqual([])
    expect(prefixSuggestions('', P, 8, ' ')).toEqual([])
  })
})

test('numberPrefixes lists Magic set codes for Magic', async () => {
  const db = await seededDb()
  seedOnePiece(db)
  const set = db.prepare(
    "INSERT INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('mtg', ?, ?, ?, '2024-06-14')"
  )
  set.run('en', 'Modern Horizons 3', 'MH3')
  set.run('ja', 'Modern Horizons 3', 'MH3')
  set.run('en', 'The List', 'PLST')
  setActiveGame(db, ['ygo', 'pkm', 'op', 'mtg'], 'mtg')
  expect(numberPrefixes(db)).toEqual(['MH3', 'PLST'])
  setActiveGame(db, ['ygo', 'pkm', 'op', 'mtg'], 'op')
  expect(numberPrefixes(db)).toEqual(['OP01'])
})

describe('frameMagicCode', () => {
  test('reads the rarity-first info line, over two lines', () => {
    expect(frameMagicCode(['C 0081\nFRA • EN'])[0]).toEqual({
      code: 'FRA 81',
      language: 'en',
      foil: false
    })
  })

  test('reads a foil star across two bands', () => {
    expect(frameMagicCode(['R 0107', 'FRA ★ EN'])[0]).toEqual({
      code: 'FRA 107',
      language: 'en',
      foil: true
    })
  })

  test('reads the number-first layout with the set count', () => {
    expect(frameMagicCode(['078/279 C\nXLN • EN'])[0].code).toBe('XLN 78')
  })

  test('mends letters read for digits in the number', () => {
    expect(frameMagicCode(['C OO8I\nFRA • EN'])[0].code).toBe('FRA 81')
  })

  test('tries a set code with a digit read as a letter after it as read', () => {
    const codes = frameMagicCode(['U 0012\nMH5 • EN']).map((r) => r.code)
    expect(codes).toContain('MHS 12')
    expect(codes.indexOf('MH5 12')).toBeLessThan(codes.indexOf('MHS 12'))
  })

  test('maps the printed language tag', () => {
    expect(frameMagicCode(['M 0291 FRA • JP'])[0].language).toBe('ja')
  })

  // Real code-band reads from the Reality Fracture photos (shot file, card): junk the catalog
  // could know as a set code, none of them followed by a language tag.
  test.each([
    ['shot_0425 FRA 188', ['€ 0180', 'Cae doVTamb ad']],
    ['FRA 67', ['FRA EN ln', 'COTS NUS TIO TIE TIT wiv ju']],
    ['FRA 227', ['FRA + EN Ww Bvar Sala', 'CBI JST WH']],
    ['FRA 270', ['FRA EV Hilosunn B', '§ Wi Cid uTS.']],
    ['FRA 396', ['Ls 0200', '« 9“']]
  ])('reads no code from a real read with no language tag (%s)', (_, texts) => {
    expect(frameMagicCode(texts)).toEqual([])
  })

  test('takes a plus read for the dot, the two lines from two bands', () => {
    expect(frameMagicCode(['C 0180', 'FRA + EN'])[0]).toEqual({
      code: 'FRA 180',
      language: 'en',
      foil: null
    })
  })

  test('reads nothing from text with no info line', () => {
    expect(frameMagicCode(['', 'Wizards of the Coast'])).toEqual([])
  })
})
