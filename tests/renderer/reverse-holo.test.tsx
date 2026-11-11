import { render, screen } from '@testing-library/react'
import { ReverseLayer } from '@/components/ReverseLayer'
import {
  coverFit,
  isReverseFinish,
  layoutFor,
  printingReverseLook,
  reverseLook
} from '@shared/reverseHolo'
import { eraPattern } from '@shared/reversePatterns'

const TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Dragon',
  'Fairy',
  'Colorless'
]

const svgOf = (url: string): string => decodeURIComponent(url.replace(/^data:image\/svg\+xml,/, ''))
// The region's cut-outs: one path each in its mask.
const paths = (region: string): string[] =>
  [...(svgOf(region).match(/<g fill='#000'>(.*)<\/g>/)?.[1] ?? '').matchAll(/d='([^']+)'/g)].map(
    (m) => m[1]
  )
const cuts = (region: string): number => paths(region).length

describe('isReverseFinish', () => {
  it('takes every reverse finish and nothing else', () => {
    expect(isReverseFinish('Reverse Holofoil')).toBe(true)
    expect(isReverseFinish('Set Logo Reverse Holofoil')).toBe(true)
    expect(isReverseFinish('Mirror Reverse Holo')).toBe(true)
    expect(isReverseFinish('Holofoil')).toBe(false)
    expect(isReverseFinish('Reversed')).toBe(false)
    expect(isReverseFinish(null)).toBe(false)
  })
})

describe('reverseLook', () => {
  it('is null for a finish that is not a reverse', () => {
    expect(
      reverseLook('Holofoil', 'SSH 011/202', { category: 'Pokemon', types: ['Grass'] })
    ).toBeNull()
  })

  it("draws each patterned era's pattern in the card's type", () => {
    for (const code of ['SVI 001/198', 'SSH 011/202', 'SUM 010/149']) {
      const look = reverseLook('Reverse Holofoil', code, { category: 'Pokemon', types: ['Fire'] })
      expect(look?.pattern?.css).toMatch(/^url\("data:image\/svg\+xml,/)
      expect(look?.pattern?.tint).toBe(eraPattern('sv', 'Fire')?.tint)
    }
  })

  it('only dims the body on eras with no drawn pattern', () => {
    const look = reverseLook('Reverse Holofoil', 'MEG 001/132', {
      category: 'Pokemon',
      types: ['Fire']
    })
    expect(look?.pattern).toBeNull()
    expect(look?.region).toMatch(/^url\("data:image\/svg\+xml,/)
  })

  it("gives Trainers the plain pattern whatever types they're given", () => {
    const trainer = reverseLook('Reverse Holofoil', 'SSH 178/202', {
      category: 'Trainer',
      types: ['Fire']
    })
    expect(trainer?.pattern?.url).toBe(eraPattern('swsh', 'plain')?.url)
  })

  it('falls back to the plain pattern for a type with no symbol', () => {
    const look = reverseLook('Reverse Holofoil', 'SUM 010/149', {
      category: 'Pokemon',
      types: ['Shadow']
    })
    expect(look?.pattern?.url).toBe(eraPattern('sm', 'plain')?.url)
  })

  it('takes a printing code or a bare set code, in any case', () => {
    const card = { category: 'Pokemon', types: ['Water'] }
    expect(reverseLook('Reverse Holofoil', 'ssh', card)).toEqual(
      reverseLook('Reverse Holofoil', 'SSH 055/202', card)
    )
  })

  it('fades the pattern in below the heading: lower on Trainers, whose name sits over the art', () => {
    const pokemon = reverseLook('Reverse Holofoil', 'SSH 011/202', {
      category: 'Pokemon',
      types: ['Grass']
    })
    const trainer = reverseLook('Reverse Holofoil', 'SSH 178/202', { category: 'Trainer' })
    expect(pokemon?.pattern?.fade).toBe('linear-gradient(transparent 8%, #000 11%)')
    expect(trainer?.pattern?.fade).toBe('linear-gradient(transparent 13%, #000 16%)')
  })

  it("leaves Sword & Shield's and Sun & Moon's stat bars plain, but not Scarlet & Violet's row", () => {
    const pokemon = { category: 'Pokemon', types: ['Grass'] }
    // The art and the Pokédex strip are cut on every modern Pokémon (one plate on Sun & Moon's);
    // the bars only on these two.
    expect(cuts(reverseLook('Reverse Holofoil', 'SSH 011/202', pokemon)!.region)).toBe(3)
    expect(cuts(reverseLook('Reverse Holofoil', 'SUM 010/149', pokemon)!.region)).toBe(2)
    expect(cuts(reverseLook('Reverse Holofoil', 'SVI 001/198', pokemon)!.region)).toBe(2)
    expect(
      cuts(reverseLook('Reverse Holofoil', 'SSH 178/202', { category: 'Trainer' })!.region)
    ).toBe(1)
  })

  it("fits Mega Evolution's frame: the body nearer the edge, the Pokédex bar's ends drawn", () => {
    const svg = (code: string, category = 'Pokemon'): string =>
      svgOf(reverseLook('Reverse Holofoil', code, { category })!.region)
    const body = (code: string, category?: string): string =>
      svg(code, category).match(/mask='url\(#c\)' d='M([\d.]+ [\d.]+)/)![1]
    // Mega Evolution's body: the same on every set, Pokémon and Trainer.
    expect(body('DLR 002/103')).toBe(body('MEG 019/132'))
    expect(body('DLR 090/103', 'Trainer')).toBe(body('DLR 002/103'))
    // The bar's rounded left end and tapering right tail are traced, not boxed.
    const strip = paths(
      reverseLook('Reverse Holofoil', 'DLR 002/103', { category: 'Pokemon' })!.region
    )[1]
    expect(strip.match(/L/g)!.length).toBeGreaterThan(6)
  })

  it('cuts the evolution badge out on Stage 1, Stage 2 and Restored Pokémon only', () => {
    const look = (code: string, stage: string | null, category = 'Pokemon'): number =>
      cuts(reverseLook('Reverse Holofoil', code, { category, stage })!.region)
    for (const code of ['GRI 002/145', 'EVO 004/108', 'DLR 002/103', 'NVI 002/101', 'PL 040/127']) {
      expect(look(code, 'Stage 1')).toBe(look(code, 'Basic') + 1)
      expect(look(code, 'Stage 2')).toBe(look(code, 'Basic') + 1)
      expect(look(code, 'Restored')).toBe(look(code, 'Basic') + 1)
      expect(look(code, null)).toBe(look(code, 'Basic'))
    }
    expect(look('GRI 120/145', 'Stage 1', 'Trainer')).toBe(look('GRI 120/145', null, 'Trainer'))
    expect(
      printingReverseLook(
        { setRarity: 'Reverse Holofoil', setCode: 'GRI 002/145' },
        { pokemon: { category: 'Pokemon', types: [], stage: 'Stage 1' } }
      )
    ).toEqual(
      reverseLook('Reverse Holofoil', 'GRI 002/145', {
        category: 'Pokemon',
        types: [],
        stage: 'Stage 1'
      })
    )
  })

  it('fits each era its own frame, and the Sun & Moon sets whose art is cropped differently', () => {
    expect(layoutFor('BS 004/102', 'Pokemon')).toBe('wotc')
    expect(layoutFor('RS 001/109', 'Pokemon')).toBe('ex')
    expect(layoutFor('PL 040/127', 'Trainer')).toBe('dp-trainer')
    expect(layoutFor('HS 001/123', 'Pokemon')).toBe('hgss')
    expect(layoutFor('NVI 002/101', 'Pokemon')).toBe('bw')
    expect(layoutFor('GEN 001/083', 'Pokemon')).toBe('xy')
    expect(layoutFor('EVO 004/108', 'Pokemon')).toBe('evo')
    expect(layoutFor('GRI 002/145', 'Pokemon')).toBe('sm')
    expect(layoutFor('UNB 002/214', 'Pokemon')).toBe('sm-late')
    expect(layoutFor('LOT 002/214', 'Trainer')).toBe('sm-lot-trainer')
    expect(layoutFor('TEU 002/181', 'Pokemon')).toBe('sm-teu')
    expect(layoutFor('SSH 011/202', 'Pokemon')).toBe('swsh')
    expect(layoutFor('SVI 001/198', 'Pokemon')).toBe('sv')
    expect(layoutFor('DLR 002/103', 'Pokemon')).toBe('me')
    expect(layoutFor('SHF:SV 001', 'Pokemon')).toBe('swsh')
    expect(layoutFor('ZZZ 001', 'Pokemon')).toBe('sv')
  })
})

describe('eraPattern', () => {
  it('has every Energy type in every era, and nothing else', () => {
    for (const era of ['sv', 'swsh', 'sm'] as const) {
      for (const type of [...TYPES, 'plain']) expect(eraPattern(era, type)).not.toBeNull()
      expect(eraPattern(era, 'Shadow')).toBeNull()
    }
  })

  it('lightens dark types into the card and darkens the rest', () => {
    expect(eraPattern('swsh', 'Darkness')?.restBlend).toBe('screen')
    expect(eraPattern('swsh', 'Grass')?.restBlend).toBe('multiply')
  })

  it('draws Sun & Moon with one big outlined symbol over the grid', () => {
    const svg = svgOf(eraPattern('sm', 'Grass')!.url)
    expect(svg).toContain("fill='none' stroke='#000'")
  })

  it('is drawn once and kept', () => {
    expect(eraPattern('sv', 'Water')).toBe(eraPattern('sv', 'Water'))
  })
})

describe('printingReverseLook', () => {
  it('reads the finish, set code and Pokémon facts off a printing and its card', () => {
    const look = printingReverseLook(
      { setRarity: 'Reverse Holofoil', setCode: 'SSH 055/202' },
      { type: 'Pokemon', pokemon: { category: 'Pokemon', types: ['Water'] } }
    )
    expect(look?.pattern?.url).toBe(eraPattern('swsh', 'Water')?.url)
    expect(printingReverseLook(null, null)).toBeNull()
  })
})

describe('ReverseLayer', () => {
  it('masks the pattern to the body, faded under the heading', () => {
    const look = reverseLook('Reverse Holofoil', 'SSH 011/202', {
      category: 'Pokemon',
      types: ['Grass']
    })!
    render(<ReverseLayer look={look} />)
    expect(screen.getByTestId('reverse-layer').dataset.pattern).toBe('yes')
    const mask = screen.getByTestId('reverse-pattern').style.maskImage
    expect(mask).toContain(look.pattern!.fade)
  })

  it('draws only the dimmed body when there is no pattern', () => {
    const look = reverseLook('Reverse Holofoil', 'MEG 001/132', {
      category: 'Pokemon',
      types: ['Fire']
    })!
    render(<ReverseLayer look={look} />)
    expect(screen.getByTestId('reverse-layer').dataset.pattern).toBe('no')
    expect(screen.queryByTestId('reverse-pattern')).toBeNull()
  })
})

describe('coverFit', () => {
  it("crops the look like object-cover crops art of another shape: Delta Reign's in a TCGdex frame", () => {
    // 733 × 1024 art in a 600 × 825 frame loses a strip off the top and the bottom.
    expect(coverFit(600 / 825, 733 / 1024)).toBe('100% 101.60%')
    expect(coverFit(600 / 825, 0.8)).toBe('110.00% 100%')
    expect(coverFit(600 / 825, 600 / 825)).toBeNull()
    expect(coverFit(600 / 825, null)).toBeNull()
  })

  it('sizes every mask of the layer by it', () => {
    const look = reverseLook('Reverse Holofoil', 'DLR 001/103', {
      category: 'Pokemon',
      types: ['Grass']
    })!
    render(<ReverseLayer look={look} fit="100% 101.60%" />)
    const layers = screen.getByTestId('reverse-layer').querySelectorAll<HTMLElement>('span')
    expect([...layers].map((l) => l.style.maskSize)).toEqual(['100% 101.60%', '100% 101.60%'])
  })
})
