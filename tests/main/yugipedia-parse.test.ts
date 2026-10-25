import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  listTitleParts,
  normalizeRarity,
  parseInfobox,
  parseReleaseDate,
  parseSetList,
  releaseDateFor
} from '../../src/main/yugipedia/parse'

const fx = (name: string): string =>
  readFileSync(
    join(__dirname, '..', 'fixtures', 'yugipedia', `${name.replace(':', ' - ')}.wikitext`),
    'utf8'
  )

describe('parseSetList', () => {
  it('captures a description:: note as the row variant, extended art as Overframe', () => {
    const r = parseSetList(
      [
        '{{Set list|region=KR|',
        'LOCH-KR012; Gagaga Girl - Cell Phone Subtraction; Ultra Rare, Secret Rare; New',
        'LOCH-KR012; Gagaga Girl - Cell Phone Subtraction; Ultra Rare, Prismatic Secret Rare, Grand Master Rare; New // description::(extended art)',
        'LOCH-KR013; Some Card; UR // just a comment',
        '}}'
      ].join('\n')
    )!
    expect(r.rows).toEqual([
      {
        code: 'LOCH-KR012',
        name: 'Gagaga Girl - Cell Phone Subtraction',
        rarities: ['Ultra Rare', 'Secret Rare']
      },
      {
        code: 'LOCH-KR012',
        name: 'Gagaga Girl - Cell Phone Subtraction',
        rarities: ['Ultra Rare', 'Prismatic Secret Rare', 'Grand Master Rare'],
        variant: 'Overframe'
      },
      { code: 'LOCH-KR013', name: 'Some Card', rarities: ['Ultra Rare'] }
    ])
    expect('variant' in r.rows[0]).toBe(false)
    expect('variant' in r.rows[2]).toBe(false)
  })

  it('reads //description:: with no space, without brackets, and on uncoded rows', () => {
    const r = parseSetList(
      [
        '{{Set list|region=JP|rarities=Ultra Rare, Secret Rare|',
        '; Zoa //description::(Manga-Style)',
        'X-002; Some Card; UR // description::Manga-Style',
        '}}'
      ].join('\n')
    )!
    expect(r.rows).toEqual([
      { code: '', name: 'Zoa', rarities: ['Ultra Rare', 'Secret Rare'], variant: 'Manga-Style' },
      { code: 'X-002', name: 'Some Card', rarities: ['Ultra Rare'], variant: 'Manga-Style' }
    ])
  })

  it('maps rarity codes confirmed on Yugipedia', () => {
    expect(normalizeRarity('MLR')).toBe('Millennium Rare')
    expect(normalizeRarity('GMR')).toBe('Grand Master Rare')
    expect(normalizeRarity('NPR')).toBe('Normal Parallel Rare')
    expect(normalizeRarity('EScR')).toBe('Extra Secret Rare')
    expect(normalizeRarity('HGR')).toBe('Holographic Rare')
    expect(normalizeRarity('GScR')).toBe('Gold Secret Rare')
    expect(normalizeRarity('PGR')).toBe('Premium Gold Rare')
  })

  it('keeps other description:: notes as the variant, without parentheses', () => {
    const r = parseSetList('{{Set list|\nX-001; Some Card; UR // description::(alternate art)\n}}')!
    expect(r.rows[0].variant).toBe('Alternate art')
  })

  it('parses the LB Japanese list', () => {
    const r = parseSetList(fx('Set Card Lists:Legend of Blue Eyes White Dragon (OCG-JP)'))!
    expect(r.rows).toHaveLength(61)
    expect(r.setPage).toBe('Legend of Blue Eyes White Dragon (Japanese)')
    expect(r.rows[0]).toEqual({ code: 'LB-00', name: 'Celtic Guardian', rarities: ['Secret Rare'] })
    expect(r.rows.find((x) => x.code === 'LB-05')).toEqual({
      code: 'LB-05',
      name: 'Dark Magician',
      rarities: ['Ultra Rare']
    })
  })

  it('parses the LOB German list', () => {
    const r = parseSetList(fx('Set Card Lists:Legend of Blue Eyes White Dragon (TCG-DE)'))!
    expect(r.rows).toHaveLength(103)
    expect(r.rows[3]).toMatchObject({ code: 'LOB-G003', name: 'Dark Magician' })
    expect(r.setPage).toBeNull()
  })

  it('uses rarities= as fallback and splits multiple rarities (KR)', () => {
    const r = parseSetList(fx('Set Card Lists:Phantom Nightmare (OCG-KR)'))!
    expect(r.rows.find((x) => x.code === 'PHNI-KR002')).toEqual({
      code: 'PHNI-KR002',
      name: 'Geistgrinder Golem',
      rarities: ['Common']
    })
    expect(r.rows.find((x) => x.code === 'PHNI-KR001')!.rarities).toEqual([
      'Super Rare',
      'Secret Rare',
      'Quarter Century Secret Rare'
    ])
  })

  it('handles noabbr lists without codes', () => {
    const r = parseSetList(fx('Set Card Lists:Vol.1 (OCG-JP)'))!
    expect(r.setPage).toBe('Vol.1')
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows.every((x) => x.code === '')).toBe(true)
    expect(r.rows.find((x) => x.name === 'Hitotsu-Me Giant')!.rarities).toEqual(['Common'])
    expect(r.rows.find((x) => x.name === 'Dark Magician')!.rarities).toEqual(['Ultra Rare'])
  })

  it('returns null without a template', () => {
    expect(parseSetList('no template')).toBeNull()
  })

  it('expands abbreviations, skips comments, strips // suffixes', () => {
    const r = parseSetList(
      '{{Set list|region=JP|\n<!-- x -->\n\nAB-001; Foo // note\nAB-002; Bar; SR, UR\nAB-003; Baz; Ultra Rare // reprint\n}}'
    )!
    expect(r.rows).toEqual([
      { code: 'AB-001', name: 'Foo', rarities: ['Common'] },
      { code: 'AB-002', name: 'Bar', rarities: ['Super Rare', 'Ultra Rare'] },
      { code: 'AB-003', name: 'Baz', rarities: ['Ultra Rare'] }
    ])
  })

  it('closes the template when }} follows the last row', () => {
    const r = parseSetList('{{Set list|region=JP|\nA-1; One; R\nA-2; Two; SR}}\nA-3; Not a row\n')!
    expect(r.rows).toEqual([
      { code: 'A-1', name: 'One', rarities: ['Rare'] },
      { code: 'A-2', name: 'Two', rarities: ['Super Rare'] }
    ])
  })

  it('concatenates multiple templates and defaults to Common', () => {
    const r = parseSetList(
      '{{Set list|region=JP|\nA-001; One\n}}\n{{Set list|region=JP|\nA-002; Two; R\n}}'
    )!
    expect(r.rows).toEqual([
      { code: 'A-001', name: 'One', rarities: ['Common'] },
      { code: 'A-002', name: 'Two', rarities: ['Rare'] }
    ])
  })
})

describe('listTitleParts', () => {
  it('splits a list title', () => {
    expect(listTitleParts('Set Card Lists:Legend of Blue Eyes White Dragon (OCG-JP)')).toEqual({
      setName: 'Legend of Blue Eyes White Dragon',
      suffix: 'OCG-JP'
    })
    expect(listTitleParts('Foo')).toBeNull()
  })
})

describe('parseInfobox', () => {
  it('reads the image and Japanese date', () => {
    const box = parseInfobox(fx('Legend of Blue Eyes White Dragon (Japanese)'))!
    expect(box.image).toBe('LB-BoosterJP.jpg')
    expect(releaseDateFor(box, 'ja')).toBe('2000-05-18')
    expect(releaseDateFor(box, 'en')).toBeNull()
  })

  it('picks per-language dates with fallbacks', () => {
    const box = parseInfobox(fx('Phantom Nightmare'))!
    expect(releaseDateFor(box, 'ko')).toBe('2023-12-02')
    expect(releaseDateFor(box, 'de')).toBe('2024-02-08')
    expect(releaseDateFor(box, 'pt')).toBe('2024-02-08')
    expect(releaseDateFor(box, 'zh-hans')).toBe('2023-12-16')
    expect(releaseDateFor(box, 'zh-hant')).toBeNull()
  })

  it('returns null without an infobox', () => {
    expect(parseInfobox('nothing')).toBeNull()
  })
})

describe('parseReleaseDate / normalizeRarity', () => {
  it('parses dates', () => {
    expect(parseReleaseDate('May 18, 2000')).toBe('2000-05-18')
    expect(parseReleaseDate('garbage')).toBeNull()
  })
  it('normalizes rarities', () => {
    expect(normalizeRarity('SR')).toBe('Super Rare')
    expect(normalizeRarity('QCScR')).toBe('Quarter Century Secret Rare')
    expect(normalizeRarity('Weird Rare')).toBe('Weird Rare')
    expect(normalizeRarity('sr')).toBe('sr')
  })
})
