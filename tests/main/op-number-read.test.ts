import { describe, expect, test } from 'vitest'
import {
  createNumberGate,
  findOpNumbers,
  frameNumber,
  readHints
} from '../../src/shared/scan/onePieceNumber'

const P = ['EB01', 'EB04', 'OP01', 'OP05', 'OP14', 'P', 'PRB01', 'ST01', 'ST10']

describe('findOpNumbers', () => {
  test.each([
    // The band holds the number, its rarity box and the block icon.
    ['OP05-119SEC2', 'OP05-119'],
    ['OP01-001 L 1', 'OP01-001'],
    ['EB01-012SR2', 'EB01-012'],
    ['PRB01-001L3', 'PRB01-001'],
    ['P-001P1', 'P-001'],
    ['ST10-001L2', 'ST10-001'],
    // The rarity "L" read as a 1 right after the number.
    ['OP01-0011', 'OP01-001'],
    // A trait's last letters before it, and the SP badge.
    ['CREWOP01-016R1', 'OP01-016'],
    ['SPOP14-108R4', 'OP14-108'],
    // Letters and digits tesseract mixes up, where only one can be meant.
    ['0P05-119', 'OP05-119'],
    ['OPO5-1I9', 'OP05-119'],
    ['5T10-001', 'ST10-001'],
    ['E801-012', 'EB01-012'],
    ['8710-00188', 'ST10-001'],
    ['8T01-012', 'ST01-012'],
    // No dash, when the number ends there.
    ['OP05119', 'OP05-119'],
    ['OP05119 SEC', 'OP05-119']
  ])('%j holds %s', (text, want) => expect(findOpNumbers(text, P)).toEqual([want]))

  test.each([
    '',
    'STRAW HAT CREW',
    // A set the catalog doesn't have.
    'OP99-001',
    // Too few digits, or digits running on with no dash to end the number.
    'OP05-11',
    'OP051191',
    // A lone P needs its dash.
    'P010',
    // A Yu-Gi-Oh set code.
    'LOB-EN005',
    // OP05-119 with its set digits lost is not promo P-119.
    'W 0P-119C',
    'OP-119'
  ])('%j holds none', (text) => expect(findOpNumbers(text, P)).toEqual([]))

  test('every number in the text, once each', () => {
    expect(findOpNumbers('OP01-001 OP05-119 OP01-001', P)).toEqual(['OP01-001', 'OP05-119'])
  })

  test("without the catalog's set codes, the families Bandai prints", () => {
    expect(findOpNumbers('OP99-001L1')).toEqual(['OP99-001'])
    expect(findOpNumbers('XX01-001')).toEqual([])
    expect(findOpNumbers('P-084')).toEqual(['P-084'])
  })
})

describe('frameNumber', () => {
  test("one number across a frame's bands is its read", () => {
    expect(frameNumber(['OP05-119SEC2', '', 'S3S611-S0dO'], P)).toBe('OP05-119')
    expect(frameNumber(['OP05-119SEC2', 'OP05-119'], P)).toBe('OP05-119')
  })
  test('two different numbers, or none, read as nothing', () => {
    expect(frameNumber(['OP05-119', 'OP01-001'], P)).toBeNull()
    expect(frameNumber([], P)).toBeNull()
    expect(frameNumber(['HAT CREW'], P)).toBeNull()
  })
})

describe('createNumberGate', () => {
  test('a number passes once it reads on two tries in a row', () => {
    const gate = createNumberGate()
    expect(gate.push('OP05-119')).toBeNull()
    expect(gate.push('OP05-119')).toBe('OP05-119')
    // And stays passed while it keeps reading.
    expect(gate.push('OP05-119')).toBe('OP05-119')
  })

  test('a miss or another number in between starts over', () => {
    const gate = createNumberGate()
    gate.push('OP05-119')
    expect(gate.push(null)).toBeNull()
    expect(gate.push('OP05-119')).toBeNull()
    expect(gate.push('OP05-118')).toBeNull()
    expect(gate.push('OP05-119')).toBeNull()
    expect(gate.push('OP05-119')).toBe('OP05-119')
  })

  test('how many tries in a row is set by need', () => {
    const gate = createNumberGate(3)
    gate.push('P-001')
    expect(gate.push('P-001')).toBeNull()
    expect(gate.push('P-001')).toBe('P-001')
  })

  test('reset forgets the streak', () => {
    const gate = createNumberGate()
    gate.push('P-001')
    gate.reset()
    expect(gate.push('P-001')).toBeNull()
  })
})

describe('readHints', () => {
  test.each([
    // Real reads off the corpus that give no number.
    ['P-073', 'OP08-073', true],
    ['OPR-0443ED', 'OP04-044', true],
    ['EIYNOP17', 'OP17-001', true],
    ['P-011L', 'OP05-011', true],
    ['NAE1100', 'OP05-073', false],
    // A lone "P" set code is in too much text to count.
    ['P', 'P-012', false],
    ['', 'OP01-001', false]
  ])('%s hints at %s: %s', (text, number, want) => {
    expect(readHints([text], number)).toBe(want)
  })
})
