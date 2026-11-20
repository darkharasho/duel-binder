import { describe, expect, it } from 'vitest'
import { parseSlabLabel } from '../../src/shared/scan/slabLabel'

describe('parseSlabLabel', () => {
  it('reads a PSA label: the number under the word, and the cert', () => {
    const text = '2012 POKEMON B & W #5\nDRAGONITE-HOLO NM\nDRAGON VAULT 7\nPSA 124302770'
    expect(parseSlabLabel(text)).toEqual({ company: 'PSA', grade: '7', cert: '124302770' })
  })

  it('reads an AGS label', () => {
    const text = '2023 POKEMON SV151 #199\nCHARIZARD EX\nAGS 9.5 GEM MINT\n10293847'
    expect(parseSlabLabel(text)).toMatchObject({ company: 'AGS', cert: '10293847' })
  })

  it('tells a PSA label by its words when the logo does not read', () => {
    const text = '2016 POKEMON XY EVOLUTIONS #11\nCHARIZARD-HOLO GEM MT\n10\n12345678'
    expect(parseSlabLabel(text)).toEqual({ company: 'PSA', grade: '10', cert: '12345678' })
  })

  it('reads PSA half grades and NM-MT before NM', () => {
    expect(parseSlabLabel('PSA NM-MT+ 8.5').grade).toBe('8.5')
    expect(parseSlabLabel('PSA NM-MT 8').grade).toBe('8')
  })

  it('passes over a PSA word with no number that fits it, as a card named EX', () => {
    // "EX" is the card's name; the grade word NM's 7 is the grade.
    const text = '2013 POKEMON PLASMA BLAST #100 FA/PALKIA EX NM\n7\n85512345'
    expect(parseSlabLabel(text).grade).toBe('7')
    // A misread number under the word: unsure, not a wrong grade.
    expect(parseSlabLabel('PSA 2012 POKEMON NM\n1\n124302770').grade).toBeUndefined()
  })

  it('reads a CGC label: the number after the word, a gap in the 10, the bracketed year', () => {
    const text =
      'Zoroark GX GEM MINT\n| Pokémon (2017) Japanese\nShining Legends - 076/072 1 0\nSuper Rare 6096255128'
    expect(parseSlabLabel(text)).toEqual({ company: 'CGC', grade: '10', cert: '6096255128' })
  })

  it('never takes a CGC "MINT 9" for PSA', () => {
    const text = 'Pokémon (2023) Japanese | MINT\nViolet ex - 087/078 9'
    expect(parseSlabLabel(text)).toMatchObject({ company: 'CGC', grade: '9' })
  })

  it('reads CGC grades off their words, which read better than the big digits', () => {
    // A stray bar after the word is no grade; the word is (this photo's slab is a CGC 9).
    expect(parseSlabLabel('Dark Hypno MINT |\nPokémon (2000) 6193875017').grade).toBe('9')
    // "8" read as "3": the word says 8.
    expect(
      parseSlabLabel('Dark Raichu NM/MINT\nPokémon (2000)\nTeam Rocket - 83/82 3\n6206777050').grade
    ).toBe('8')
    // A "+" (or the number's half) says the half.
    expect(
      parseSlabLabel('Dark Dragonite NM/MINT+\nPokémon (2004)\nEX TRR - 15/109 8.5').grade
    ).toBe('8.5')
    expect(parseSlabLabel('Gengar EX VERY GOOD+\nPokémon (2014)\nPhantom Forces').grade).toBe('3.5')
    // A card's "EX" or "ex" is no grade word.
    expect(
      parseSlabLabel('Mega Rayquaza ex\nPokémon (2026) Japanese\nStorm 058/076').grade
    ).toBeUndefined()
    expect(parseSlabLabel('Pokémon (2004)\nEX Team Rocket Returns - 25/109').grade).toBeUndefined()
  })

  it('reads BGS with its qualifier', () => {
    expect(parseSlabLabel('BECKETT PRISTINE 10 BLACK LABEL 0012345678')).toEqual({
      company: 'BGS',
      grade: '10',
      label: 'Black Label',
      cert: '0012345678'
    })
  })

  it('reads an authentic slab, and nothing from noise', () => {
    expect(parseSlabLabel('PSA 1999 POKEMON AUTHENTIC 12345678')).toMatchObject({
      company: 'PSA',
      grade: 'Authentic'
    })
    expect(parseSlabLabel('ee ~~ |||')).toEqual({})
  })
})
