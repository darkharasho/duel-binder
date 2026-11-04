import { describe, expect, test } from 'vitest'
import { normalizeOpNumber, prefixSuggestions } from '../../src/shared/scan/onePieceNumber'
import { numberPrefixes } from '../../src/main/repo/scan'
import { setActiveGame } from '../../src/main/cloud/activeGame'
import { seededDb } from './helpers'
import { seedOnePiece } from '../fixtures/onePiece'

describe('normalizeOpNumber', () => {
  test.each([
    ['op05-119', 'OP05-119'],
    ['OP05119', 'OP05-119'],
    ['op5-119', 'OP05-119'],
    [' st10 - 003 ', 'ST10-003'],
    ['prb01-001', 'PRB01-001'],
    ['p-084', 'P-084'],
    ['P084', 'P-084'],
    ['EB04-061', 'EB04-061']
  ])('%j reads as %s', (t, want) => expect(normalizeOpNumber(t)).toBe(want))
  test.each(['', 'OP05-11', 'OP0511', 'OP05-1199', 'EB04-061_p1', 'LOB-EN001', '119'])(
    '%j is not a number',
    (t) => expect(normalizeOpNumber(t)).toBeNull()
  )
})

const P = ['EB01', 'OP01', 'OP02', 'OP10', 'OP11', 'P', 'PRB01', 'ST01']
test('suggests set codes as typed', () => {
  expect(prefixSuggestions('op1', P)).toEqual(['OP10-', 'OP11-'])
  expect(prefixSuggestions('p', P)).toEqual(['P-', 'PRB01-'])
  expect(prefixSuggestions('', P)).toEqual([])
  expect(prefixSuggestions('OP05-1', P)).toEqual([])
  expect(prefixSuggestions('OP05119', P)).toEqual([])
  expect(prefixSuggestions('o', P, 2)).toEqual(['OP01-', 'OP02-'])
})

test('numberPrefixes lists the active game only', async () => {
  const db = await seededDb()
  seedOnePiece(db)
  setActiveGame(db, ['ygo', 'pkm', 'op'], 'op')
  expect(numberPrefixes(db)).toEqual(['OP01'])
  setActiveGame(db, ['ygo', 'pkm', 'op'], 'ygo')
  expect(numberPrefixes(db)).not.toContain('OP01')
  expect(numberPrefixes(db).length).toBeGreaterThan(0)
})
