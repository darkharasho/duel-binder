import { describe, expect, it } from 'vitest'
import {
  agsGold,
  bgsMetal,
  gradeWord,
  isPristine,
  labelText,
  sgcBadge,
  slabKind
} from '../../src/renderer/src/features/graded/slabLook'

const g = (grade: string, label = '', subgrades = '') => ({ grade, label, subgrades })

describe('slab look', () => {
  it('knows the seven graders, Beckett by name too, and plain for the rest', () => {
    expect(['psa', 'BGS', 'Beckett', 'cgc', 'SGC', 'TAG', 'ACE', 'ags'].map(slabKind)).toEqual([
      'PSA',
      'BGS',
      'BGS',
      'CGC',
      'SGC',
      'TAG',
      'ACE',
      'AGS'
    ])
    expect(slabKind('ARS')).toBe('plain')
    expect(slabKind('My Grader')).toBe('plain')
  })

  it('says each grader’s own word for a grade', () => {
    expect(gradeWord('PSA', g('10'))).toBe('GEM MT')
    expect(gradeWord('PSA', g('8.5'))).toBe('NM-MT+')
    expect(gradeWord('PSA', g('1'))).toBe('PR')
    expect(gradeWord('BGS', g('9.5'))).toBe('GEM MINT')
    expect(gradeWord('BGS', g('10'))).toBe('PRISTINE')
    expect(gradeWord('CGC', g('10'))).toBe('GEM MINT')
    expect(gradeWord('CGC', g('10', 'Pristine'))).toBe('PRISTINE')
    expect(gradeWord('CGC', g('8'))).toBe('NM/MINT')
    expect(gradeWord('TAG', g('9'))).toBe('MINT')
    expect(gradeWord('ACE', g('Authentic'))).toBe('AUTHENTIC')
    expect(gradeWord('AGS', g('10'))).toBe('GEM-MT')
    expect(gradeWord('AGS', g('9.5'))).toBe('MINT+')
    expect(gradeWord('AGS', g('9'))).toBe('MINT')
  })

  it('a label the user typed wins over the table, but Black Label is only a colour', () => {
    expect(gradeWord('PSA', g('10', 'Gem Mint'))).toBe('GEM MINT')
    expect(gradeWord('BGS', g('10', 'Black Label'))).toBe('PRISTINE')
  })

  it('colours Beckett’s label by grade: black for four 10s or Black Label, gold from 9.5', () => {
    expect(bgsMetal(g('10', '', '10 10 10 10'))).toBe('black')
    expect(bgsMetal(g('10', 'Black Label'))).toBe('black')
    expect(bgsMetal(g('10', '', '10 9.5 10 10'))).toBe('gold')
    expect(bgsMetal(g('9.5'))).toBe('gold')
    expect(bgsMetal(g('9'))).toBe('silver')
  })

  it('frames AGS in gold from 9.5, navy below', () => {
    expect(agsGold(g('10'))).toBe(true)
    expect(agsGold(g('9.5'))).toBe(true)
    expect(agsGold(g('9'))).toBe(false)
    expect(agsGold(g('Authentic'))).toBe(false)
  })

  it('Pristine only on a 10; SGC’s badge is short', () => {
    expect(isPristine(g('10', 'pristine'))).toBe(true)
    expect(isPristine(g('9.5', 'Pristine'))).toBe(false)
    expect(sgcBadge('GEM MINT')).toBe('GM')
    expect(sgcBadge('NM-MT+')).toBe('NM-MT+')
    expect(sgcBadge('EX-NM+')).toBe('EX-NM+')
  })

  it('builds the label’s lines from the card, its set and the set’s year', () => {
    const slab = {
      ...g('Authentic'),
      game: 'ygo' as const,
      card: { name: 'Dark Magician' },
      printing: {
        setName: 'Legend of Blue Eyes',
        setCode: 'LOB-EN005',
        setRarity: 'Ultra Rare',
        releaseDate: '2002-03-08'
      }
    }
    expect(labelText('PSA', slab as never)).toEqual({
      yearGame: '2002 Yu-Gi-Oh!',
      setName: 'Legend of Blue Eyes',
      name: 'Dark Magician',
      rarity: 'Ultra Rare',
      number: '#LOB-EN005',
      grade: 'AUTH',
      word: 'AUTHENTIC'
    })
    const undated = { ...slab, printing: { ...slab.printing, releaseDate: undefined, setCode: '' } }
    expect(labelText('PSA', undated as never)).toMatchObject({ yearGame: 'Yu-Gi-Oh!', number: '' })
  })
})
