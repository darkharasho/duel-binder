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
  foilClip,
  foilKindFor,
  pokemonLayoutFor
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

describe('pokemonLayoutFor', () => {
  it('knows the e-Reader and WotC sets, and Trainers, from the set code and category', () => {
    expect(pokemonLayoutFor('SK 1/144', 'Pokemon')).toBe('ereader')
    expect(pokemonLayoutFor('AQ 12/147', 'Trainer')).toBe('ereader-trainer')
    expect(pokemonLayoutFor('BS 1/102', 'Pokemon')).toBe('wotc')
    expect(pokemonLayoutFor('N1 9/111', 'Trainer')).toBe('wotc-trainer')
    expect(pokemonLayoutFor('SVI 1/198', 'Pokemon')).toBe('modern')
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

describe('foilClip', () => {
  const box = { top: 10, bottom: 50, left: 8, right: 8 }

  it('keeps a holo inside the art, stopping at its bottom edge', () => {
    expect(foilClip('holo', box, 0.7)).toBe('polygon(92% 10%, 92% 50%, 8% 50%, 8% 10%)')
  })

  it('cuts only the art out of a reverse, so the strip under it stays foil', () => {
    const clip = foilClip('reverse', box, 0.7)!
    expect(clip).toMatch(/^polygon\(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%/)
    expect(clip).toContain('8% 50%')
    expect(clip).not.toContain('55%')
  })

  it('rounds only the left corners of an e-Reader box', () => {
    const clip = foilClip('holo', ART_WINDOWS.ereader, 0.7)!
    expect(clip.split(',').length).toBeGreaterThan(10)
    expect(clip).toContain('95.8% 10.8%')
    expect(clip).toContain('95.8% 48.5%')
    expect(clip).not.toContain('9.7% 10.8%')
  })

  it('leaves whole-card foils, and a missing window, unclipped', () => {
    expect(foilClip('fullart', box, 0.7)).toBeUndefined()
    expect(foilClip('gold', box, 0.7)).toBeUndefined()
    expect(foilClip('holo', null, 0.7)).toBeUndefined()
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
      <FoilLayer kind="none" window={ART_WINDOWS.modern} aspect={aspect} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('clips a holo to the window it is given', () => {
    render(<FoilLayer kind="holo" window={ART_WINDOWS.modern} aspect={aspect} />)
    const layer = screen.getByTestId('foil-layer')
    expect(layer).toHaveAttribute('data-foil', 'holo')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer.style.clipPath).toContain('92.8% 9.2%')
    expect(layer).not.toHaveAttribute('data-faint')
  })

  it('leaves a whole-card foil unclipped', () => {
    render(<FoilLayer kind="fullart" window={null} aspect={aspect} />)
    const layer = screen.getByTestId('foil-layer')
    expect(layer.style.clipPath).toBe('')
    expect(layer).not.toHaveAttribute('data-faint')
  })

  it('is a faint sheen when a masked foil has no window', () => {
    render(<FoilLayer kind="reverse" window={null} aspect={aspect} />)
    expect(screen.getByTestId('foil-layer')).toHaveAttribute('data-faint')
  })

  it('takes the frame aspect it is given', () => {
    render(<FoilLayer kind="holo" window={null} aspect={{ width: 421, height: 614 }} />)
    expect(screen.getByTestId('foil-layer').style.aspectRatio).toBe('421 / 614')
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
