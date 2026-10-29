import { describe, expect, it } from 'vitest'
import {
  collectorNumberCandidates,
  parseCollectorNumber
} from '../../src/shared/scan/collectorNumber'

describe('parseCollectorNumber', () => {
  it('reads number and total', () => {
    expect(parseCollectorNumber('045/193')).toEqual({
      setAbbrev: null,
      number: '045',
      total: '193'
    })
  })
  it('reads the set abbreviation, skipping the language tag', () => {
    expect(parseCollectorNumber('PAL EN 045/193')).toEqual({
      setAbbrev: 'PAL',
      number: '045',
      total: '193'
    })
    expect(parseCollectorNumber('SV1S 001/078')).toEqual({
      setAbbrev: 'SV1S',
      number: '001',
      total: '078'
    })
    expect(parseCollectorNumber('045/193 PAL EN')?.setAbbrev).toBe('PAL')
  })
  it('keeps letters in the number', () => {
    expect(parseCollectorNumber('TG05/TG30')).toEqual({
      setAbbrev: null,
      number: 'TG05',
      total: 'TG30'
    })
    expect(parseCollectorNumber('GG12/GG70')?.number).toBe('GG12')
  })
  it('reads a number with no total', () => {
    expect(parseCollectorNumber('SVP EN SV049')).toEqual({
      setAbbrev: 'SVP',
      number: 'SV049',
      total: null
    })
  })
  it('rejects text that is not a number', () => {
    expect(parseCollectorNumber('HP 70')).toBeNull()
    expect(parseCollectorNumber('')).toBeNull()
  })
})

describe('collectorNumberCandidates', () => {
  it('reads misread digits', () => {
    expect(collectorNumberCandidates('O45/l93')).toContainEqual({
      setAbbrev: null,
      number: '045',
      total: '193'
    })
  })
  it('puts the plain reading first', () => {
    expect(collectorNumberCandidates('PAL EN 045/193')[0]).toEqual({
      setAbbrev: 'PAL',
      number: '045',
      total: '193'
    })
  })
  it('keeps a letter prefix while fixing the digits', () => {
    expect(collectorNumberCandidates('TG0S/TG30')).toContainEqual({
      setAbbrev: null,
      number: 'TG05',
      total: 'TG30'
    })
  })
  it('is empty for text without a number', () => {
    expect(collectorNumberCandidates('HP 70')).toEqual([])
  })
})
