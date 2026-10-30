import { readFileSync } from 'node:fs'
import { render, screen, waitFor } from '@testing-library/react'
import { FoilLayer } from '@/components/FoilLayer'
import { PanelCardArt } from '@/components/PanelCardArt'
import { TiltCard } from '@/components/TiltCard'
import { CardSheet } from '@/components/CardSheet'
import { findArtWindow, type ArtBitmap } from '@shared/artWindow'
import {
  ART_WINDOWS,
  cardFoil,
  chooseArtWindow,
  artOutline,
  foilFinishFor,
  foilKindFor,
  foilMask,
  pokemonLayoutFor,
  reverseTextureFor,
  texturePlacement
} from '@shared/foil'
import { PKM_ID_MIN } from '@shared/games'
import { createMockApi, renderWithProviders } from './mockApi'

const pkm = (setRarity: string, rarity: string | null): string =>
  foilKindFor({ setRarity }, 'pkm', rarity)
const CARD = { width: 733, height: 1024 }
const pokemonCard = (
  rarity: string | null,
  category = 'Pokemon'
): { id: number; pokemon: { rarity: string | null; category: string } } => ({
  id: PKM_ID_MIN + 1,
  pokemon: { rarity, category }
})

describe('foilKindFor', () => {
  it('keys off the printing: one card is plain as Normal and reverse as Reverse Holofoil', () => {
    expect(pkm('Normal', 'Common')).toBe('none')
    expect(pkm('Reverse Holofoil', 'Common')).toBe('reverse')
    expect(pkm('Normal', 'Rare')).toBe('none')
    expect(pkm('Holofoil', 'Rare')).toBe('holo')
    expect(pkm('1st Edition', 'Rare')).toBe('none')
  })

  it('reads a finish behind its stamp', () => {
    expect(pkm('1st Edition Holofoil', 'Rare')).toBe('holo')
    expect(pkm('Set Logo Reverse Holofoil', 'Uncommon')).toBe('reverse')
    expect(pkm('Shadowless Normal', 'Holo Rare')).toBe('none')
  })

  it('gives rarities that are foil on every printing their foil, whatever the label', () => {
    expect(pkm('Holofoil', 'Illustration rare')).toBe('fullart')
    expect(pkm('Normal', 'Special illustration rare')).toBe('fullart')
    expect(pkm('Reverse Holofoil', 'Ultra Rare')).toBe('fullart')
    expect(pkm('Holofoil', 'Secret Rare')).toBe('fullart')
    expect(pkm('Holofoil', 'Hyper rare')).toBe('gold')
    expect(pkm('Holofoil', 'Mega Hyper Rare')).toBe('gold')
  })

  it('maps Yu-Gi-Oh! rarities and leaves the plain ones without foil', () => {
    expect(foilKindFor({ setRarity: 'Common' }, 'ygo')).toBe('none')
    expect(foilKindFor({ setRarity: 'Rare' }, 'ygo')).toBe('none')
    expect(foilKindFor({ setRarity: 'Secret Rare' }, 'ygo')).toBe('holo')
    expect(foilKindFor({ setRarity: 'Starlight Rare' }, 'ygo')).toBe('fullart')
    expect(foilKindFor({ setRarity: 'Gold Rare' }, 'ygo')).toBe('gold')
  })
})

describe('foilFinishFor', () => {
  it('gives each era its own holo', () => {
    expect(foilFinishFor('holo', 'pkm', 'BS 4/102', 'Rare')).toBe('stars')
    expect(foilFinishFor('holo', 'pkm', 'SK 1/144', 'Rare')).toBe('glitter')
    expect(foilFinishFor('holo', 'pkm', 'RG 3/112', 'Rare')).toBe('sheen')
    expect(foilFinishFor('holo', 'pkm', 'SVI 1/198', 'Rare')).toBe('lines')
  })

  it('gives modern reverses a pattern and older ones a plain sheen', () => {
    expect(foilFinishFor('reverse', 'pkm', 'SVI 1/198', 'Common')).toBe('reverse')
    expect(foilFinishFor('reverse', 'pkm', 'EX 1/165', 'Common')).toBe('reverse-flat')
    expect(foilFinishFor('reverse', 'pkm', 'RG 3/112', 'Common')).toBe('reverse-flat')
  })

  it('takes the look of a rarity that has its own', () => {
    expect(foilFinishFor('fullart', 'pkm', 'SVI 1/198', 'Radiant Rare')).toBe('lattice')
    expect(foilFinishFor('fullart', 'pkm', 'SVI 1/198', 'Holo Rare VMAX')).toBe('ridges')
    expect(foilFinishFor('fullart', 'pkm', 'SVI 1/198', 'Character Rare')).toBe('fields')
    expect(foilFinishFor('fullart', 'pkm', 'SVI 1/198', 'Full Art Trainer')).toBe('scanlines')
    expect(foilFinishFor('holo', 'pkm', 'SVI 1/198', 'Amazing Rare')).toBe('amazing')
    expect(foilFinishFor('gold', 'pkm', 'SVI 1/198', 'Hyper rare')).toBe('gold')
  })

  it('has no finish without a foil', () => {
    expect(foilFinishFor('none', 'pkm', 'SVI 1/198', 'Common')).toBe('none')
  })
})

describe('pokemonLayoutFor', () => {
  it('knows the e-Reader and WotC sets, and Trainers, from the set code and category', () => {
    expect(pokemonLayoutFor('SK 1/144', 'Pokemon')).toBe('ereader')
    expect(pokemonLayoutFor('AQ 12/147', 'Trainer')).toBe('ereader-trainer')
    expect(pokemonLayoutFor('BS 1/102', 'Pokemon')).toBe('wotc')
    expect(pokemonLayoutFor('N1 9/111', 'Trainer')).toBe('wotc-trainer')
    expect(pokemonLayoutFor('SVI 1/198', 'Pokemon')).toBe('modern')
    expect(pokemonLayoutFor('RG 3/112', 'Pokemon')).toBe('modern')
    expect(pokemonLayoutFor('SVI 170/198', 'Trainer')).toBe('modern-trainer')
  })

  it('has no layout for Energy', () => {
    expect(pokemonLayoutFor('SVI 257/198', 'Energy')).toBeNull()
  })
})

describe('cardFoil', () => {
  it('never looks for a window on a full art, or on a card with no foil', () => {
    const printing = { setRarity: 'Holofoil', setCode: 'SVI 200/198' }
    expect(cardFoil(printing, pokemonCard('Illustration rare'))).toMatchObject({
      kind: 'fullart',
      window: null,
      detect: false
    })
    expect(
      cardFoil({ setRarity: 'Normal', setCode: 'SVI 1/198' }, pokemonCard('Common'))
    ).toMatchObject({ kind: 'none', detect: false })
  })

  it('looks for the rounded box on the e-Reader sets', () => {
    expect(
      cardFoil({ setRarity: 'Holofoil', setCode: 'SK 1/144' }, pokemonCard('Rare'))
    ).toMatchObject({ kind: 'holo', window: ART_WINDOWS.ereader, detect: true, roundedLeft: true })
  })

  it("takes Yu-Gi-Oh!'s box from the frame, without detection", () => {
    const foil = cardFoil(
      { setRarity: 'Secret Rare', setCode: 'LOB-EN001' },
      { id: 5, frameType: 'effect' }
    )
    expect(foil).toMatchObject({ kind: 'holo', detect: false })
    expect(foil.window).toMatchObject({ top: 18.1, left: 11.9 })
  })
})

describe('chooseArtWindow', () => {
  const layout = ART_WINDOWS.modern
  const near = { top: 9.5, bottom: 49, left: 7, right: 7 }

  it('prefers a confident box that agrees with the layout', () => {
    expect(chooseArtWindow({ window: near, confidence: 0.9 }, layout)).toMatchObject(near)
  })

  it('falls back to the layout on a weak box, or one far from it', () => {
    expect(chooseArtWindow({ window: near, confidence: 0.2 }, layout)).toBe(layout)
    expect(chooseArtWindow({ window: { ...near, top: 5 }, confidence: 0.9 }, layout)).toBe(layout)
    expect(chooseArtWindow(null, layout)).toBe(layout)
  })

  it('keeps the layout rounded corners on a found box', () => {
    const found = { ...near, right: 4 }
    expect(chooseArtWindow({ window: found, confidence: 0.9 }, ART_WINDOWS.ereader)).toMatchObject({
      leftRadius: 7
    })
  })

  it('has no window when neither is known', () => {
    expect(chooseArtWindow(null, null)).toBeNull()
  })
})

describe('reverseTextureFor', () => {
  const art = { top: 9.4, bottom: 49.9, left: 7.4, right: 7.5 }
  const table = {
    'Grass/basic': { url: 'grass-basic', art },
    'Darkness/stage': { url: 'dark-stage', art }
  }
  const pokemon = (
    types: string[],
    stage: string | null,
    category = 'Pokemon'
  ): { rarity: string; category: string; types: string[]; stage: string | null } => ({
    rarity: 'Common',
    category,
    types,
    stage
  })

  it('picks by Scarlet & Violet, type and Basic or evolved', () => {
    expect(reverseTextureFor('SVI 5/198', pokemon(['Grass'], 'Basic'), table)?.url).toBe(
      'grass-basic'
    )
    expect(reverseTextureFor('PAR 80/182', pokemon(['Darkness'], 'Stage1'), table)?.url).toBe(
      'dark-stage'
    )
    expect(reverseTextureFor('TEF 80/162', pokemon(['Darkness'], 'Stage2'), table)?.url).toBe(
      'dark-stage'
    )
  })

  it('has nothing for other eras, Trainers, or a pair not in the table', () => {
    expect(reverseTextureFor('BLW 40/114', pokemon(['Grass'], 'Basic'), table)).toBeNull()
    expect(reverseTextureFor('SVI 170/198', pokemon([], null, 'Trainer'), table)).toBeNull()
    expect(reverseTextureFor('SVI 257/198', pokemon(['Grass'], null, 'Energy'), table)).toBeNull()
    expect(reverseTextureFor('SVI 5/198', pokemon(['Fire'], 'Basic'), table)).toBeNull()
  })

  it('ships empty, so every reverse keeps the plain foil', () => {
    expect(reverseTextureFor('SVI 5/198', pokemon(['Grass'], 'Basic'))).toBeNull()
    expect(
      cardFoil({ setRarity: 'Reverse Holofoil', setCode: 'SVI 5/198' }, pokemonCard('Common'))
        .texture
    ).toBeNull()
  })
})

describe('texturePlacement', () => {
  const art = { top: 10, bottom: 50, left: 10, right: 10 }

  it('lays a texture flat when its art is already on the window', () => {
    expect(texturePlacement(art, null)).toEqual({ size: '100% 100%', position: '0% 0%' })
  })

  it('scales a texture so its art lands on the window', () => {
    const { size } = texturePlacement(art, { top: 10, bottom: 70, left: 10, right: 10 })
    expect(size).toBe('100.2% 150%')
  })
})

describe('foilMask', () => {
  const box = { top: 10, bottom: 50, left: 8, right: 8 }
  const path = (mask: string | undefined): string =>
    decodeURIComponent(mask!).match(/ d='([^']+)'/)![1]

  it('keeps a holo inside the art, stopping at its bottom edge', () => {
    expect(path(foilMask('holo', box, 0.7))).toBe('M92 10L92 50L8 50L8 10Z')
  })

  it('cuts only the art out of a reverse, so the strip under it stays foil', () => {
    expect(path(foilMask('reverse', box, 0.7))).toBe('M0 0H100V100H0ZM92 10L92 50L8 50L8 10Z')
  })

  it('leaves whole-card foils, and a missing window, unmasked', () => {
    expect(foilMask('fullart', box, 0.7)).toBeUndefined()
    expect(foilMask('gold', box, 0.7)).toBeUndefined()
    expect(foilMask('holo', null, 0.7)).toBeUndefined()
  })
})

describe('artOutline', () => {
  it('rounds only the left corners of an e-Reader box', () => {
    const points = artOutline(ART_WINDOWS.ereader, 0.7)
    expect(points.length).toBeGreaterThan(10)
    expect(points).toContainEqual([95.8, 10.8])
    expect(points).toContainEqual([95.8, 48.5])
    expect(points).not.toContainEqual([9.7, 10.8])
  })
})

describe('findArtWindow', () => {
  /** A plain frame with a busy box drawn on it. */
  function card(box: { top: number; bottom: number; left: number; right: number }): ArtBitmap {
    const width = 300
    const height = 418
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inside =
          y >= (box.top / 100) * height &&
          y < (box.bottom / 100) * height &&
          x >= (box.left / 100) * width &&
          x < (1 - box.right / 100) * width
        const value = inside ? 40 : 220
        const at = (y * width + x) * 4
        data.fill(value, at, at + 3)
        data[at + 3] = 255
      }
    }
    return { data, width, height }
  }

  it('finds a box on a card', () => {
    const found = findArtWindow(card({ top: 10, bottom: 49, left: 8, right: 8 }))!
    expect(found.confidence).toBeGreaterThan(0.8)
    expect(found.window.top).toBeCloseTo(10, -0.5)
    expect(found.window.bottom).toBeCloseTo(49, -0.5)
    expect(found.window.left).toBeCloseTo(8, -0.5)
  })

  it('has no confidence in a card with no box', () => {
    const noise = card({ top: 0, bottom: 0, left: 0, right: 0 })
    const found = findArtWindow(noise)
    expect(found === null || found.confidence < 0.5).toBe(true)
  })
})

describe('FoilLayer', () => {
  const aspect = CARD

  it('draws nothing at all without a foil', () => {
    const { container } = render(
      <FoilLayer kind="none" finish="lines" window={ART_WINDOWS.modern} aspect={aspect} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('clips a holo to the window it is given', () => {
    render(<FoilLayer kind="holo" finish="lines" window={ART_WINDOWS.modern} aspect={aspect} />)
    const layer = screen.getByTestId('foil-layer')
    expect(layer).toHaveAttribute('data-foil', 'holo')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer.style.getPropertyValue('--foil-mask')).toContain('data:image/svg')
    expect(layer).not.toHaveAttribute('data-faint')
  })

  it('leaves a whole-card foil unclipped', () => {
    render(<FoilLayer kind="fullart" finish="lines" window={null} aspect={aspect} />)
    const layer = screen.getByTestId('foil-layer')
    expect(layer.style.getPropertyValue('--foil-mask')).toBe('')
    expect(layer).not.toHaveAttribute('data-faint')
  })

  it('is a faint sheen when a masked foil has no window', () => {
    render(<FoilLayer kind="reverse" finish="lines" window={null} aspect={aspect} />)
    expect(screen.getByTestId('foil-layer')).toHaveAttribute('data-faint')
  })

  it('forms no stacking context, so its layers blend with the card', () => {
    render(<FoilLayer kind="holo" finish="lines" window={ART_WINDOWS.modern} aspect={aspect} />)
    const layer = screen.getByTestId('foil-layer')
    expect(layer.style.clipPath).toBe('')
    expect(layer.style.opacity).toBe('')
    expect(layer.children.length).toBeGreaterThan(1)
  })

  it('carries a texture and marks itself textured', () => {
    render(
      <FoilLayer
        kind="reverse"
        finish="reverse"
        texture={{ url: 'pattern.png', art: ART_WINDOWS.modern }}
        window={ART_WINDOWS.modern}
        aspect={aspect}
      />
    )
    const layer = screen.getByTestId('foil-layer')
    expect(layer).toHaveAttribute('data-textured')
    expect(layer.style.getPropertyValue('--foil-texture')).toContain('pattern.png')
  })

  it('takes the frame aspect it is given', () => {
    render(
      <FoilLayer kind="holo" finish="lines" window={null} aspect={{ width: 421, height: 614 }} />
    )
    expect(screen.getByTestId('foil-layer').style.aspectRatio).toBe('421 / 614')
  })
})

describe('foil styles', () => {
  const css = readFileSync('src/renderer/src/index.css', 'utf8')

  it('wraps every spectrum seamlessly: its last stop is its first', () => {
    const spectra = [...css.matchAll(/--foil-spectrum: ([\s\S]*?);/g)].map((m) => m[1])
    expect(spectra.length).toBeGreaterThan(5)
    const hue = (stop: string): string => stop.replace('hsl(360', 'hsl(0').replace(/\)[^)]*$/, ')')
    for (const spectrum of spectra) {
      expect(spectrum.startsWith('repeating-linear-gradient')).toBe(true)
      const stops = spectrum.match(/hsl\([^)]*\)/g)!
      expect(hue(stops[stops.length - 1])).toBe(hue(stops[0]))
    }
  })

  it('never tiles a spectrum, whose tile edges would show as a hard line', () => {
    const rules = css.split('}').filter((rule) => rule.includes('var(--foil-spectrum)'))
    expect(rules.length).toBeGreaterThan(1)
    for (const rule of rules) expect(rule).toMatch(/background-repeat:[^;]*no-repeat;/)
  })

  it('keeps every hue rate inside the spectrum', () => {
    const rates = [...css.matchAll(/--foil-hue-[xy]: (-?[\d.]+);/g)].map((m) => Number(m[1]))
    for (const rate of rates) expect(Math.abs(rate)).toBeLessThanOrEqual(4)
  })

  it('keeps a still version of reverse foils at rest, and of nothing else', () => {
    const shown = [...css.matchAll(/\.foil\[data-finish='([\w-]+)'\] \.foil-rest/g)].map(
      (m) => m[1]
    )
    expect(shown.sort()).toEqual(['reverse', 'reverse-flat'])
  })
})

describe('TiltCard glare', () => {
  it('is left out for a card with nothing to catch the light', () => {
    const { container } = render(<TiltCard glare={false}>x</TiltCard>)
    expect(container.querySelector('.mix-blend-overlay')).toBeNull()
  })
})

describe('PanelCardArt', () => {
  function renderPanel(
    foil: Parameters<typeof PanelCardArt>[0]['foil'],
    artBytes = vi.fn(async () => null)
  ): typeof artBytes {
    renderWithProviders(
      <CardSheet onClose={() => {}}>
        <PanelCardArt imageId={PKM_ID_MIN + 2} printingId={7} alt="Card" foil={foil} />
      </CardSheet>,
      { api: createMockApi({ images: { artBytes } }) }
    )
    return artBytes
  }

  it('shows no foil and asks for no window on a Normal printing', () => {
    const asked = renderPanel(
      cardFoil({ setRarity: 'Normal', setCode: 'SVI 1/198' }, pokemonCard('Common'))
    )
    expect(screen.queryAllByTestId('foil-layer')).toHaveLength(0)
    expect(asked).not.toHaveBeenCalled()
  })

  it('finds the window of a Reverse Holofoil printing of the same card', async () => {
    const asked = renderPanel(
      cardFoil({ setRarity: 'Reverse Holofoil', setCode: 'SVI 1/198' }, pokemonCard('Common'))
    )
    await waitFor(() => expect(screen.getAllByTestId('foil-layer').length).toBeGreaterThan(0))
    expect(screen.getAllByTestId('foil-layer')[0]).toHaveAttribute('data-foil', 'reverse')
    expect(asked).toHaveBeenCalledWith({ imageId: PKM_ID_MIN + 2, printingId: 7 })
  })

  it('never asks for a window on a full art', () => {
    const asked = renderPanel(
      cardFoil({ setRarity: 'Holofoil', setCode: 'SVI 200/198' }, pokemonCard('Illustration rare'))
    )
    expect(screen.getAllByTestId('foil-layer')[0]).toHaveAttribute('data-foil', 'fullart')
    expect(asked).not.toHaveBeenCalled()
  })
})
