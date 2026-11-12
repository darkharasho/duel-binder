import { describe, expect, test } from 'vitest'
import { normalizeMagicCode } from '../../src/shared/scan/magicCode'
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
