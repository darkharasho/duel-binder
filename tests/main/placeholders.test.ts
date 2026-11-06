import { describe, expect, it, vi } from 'vitest'
import {
  checkPlaceholderRequest,
  rarityChip,
  sheetCount,
  type PlaceholderRequest
} from '../../src/shared/placeholders'

vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: {} }))
const { placeholderHtml } = await import('../../src/main/placeholders')

const request = (count: number, name = 'Pikachu'): PlaceholderRequest => ({
  setName: 'Delta Reign',
  setCode: 'DLR',
  style: 'soft',
  cards: Array.from({ length: count }, (_, i) => ({
    imageId: i + 1,
    name,
    number: `DLR ${i + 1}/103`,
    rarity: null
  }))
})

describe('placeholder sheets', () => {
  it('puts nine pockets on a sheet', () => {
    const html = placeholderHtml(request(10))
    expect(html.match(/class="sheet"/g)).toHaveLength(2)
    expect(html.match(/class="pocket"/g)).toHaveLength(10)
    expect(html).toContain('ygo-img://full/10')
    expect(sheetCount(9)).toBe(1)
    expect(sheetCount(10)).toBe(2)
  })
  it('escapes card text', () => {
    const html = placeholderHtml(request(1, '<img src=x onerror=alert(1)>'))
    expect(html).not.toContain('<img src=x')
  })
  it('shows the set code unless the rarity has a chip', () => {
    expect(placeholderHtml(request(1))).toContain('>DLR</div>')
    expect(rarityChip('Illustration rare')?.text).toBe('IR')
    expect(rarityChip('Special illustration rare')?.text).toBe('SIR')
    expect(rarityChip('Common')).toBeNull()
    expect(rarityChip(null)).toBeNull()
  })
  it('marks a reverse holo pocket, and names finishes other than Normal', () => {
    const pocket = (finish: string, rarity: string | null = 'Common'): string =>
      placeholderHtml({ ...request(1), cards: [{ ...request(1).cards[0], rarity, finish }] })
    expect(pocket('Reverse Holofoil')).toContain('>RH</div>')
    expect(pocket('Reverse Holofoil')).toContain('DLR 1/103 · Common · Reverse Holofoil')
    expect(pocket('Normal')).toContain('>DLR</div>')
    expect(pocket('Normal')).toContain('DLR 1/103 · Common</div>')
    // A rarity chip keeps its spot over the finish.
    expect(pocket('Reverse Holofoil', 'Illustration Rare')).toContain('>IR</div>')
  })
  it('turns away a finish that is not text', () => {
    const bad = { ...request(1), cards: [{ ...request(1).cards[0], finish: 5 }] }
    expect(() => checkPlaceholderRequest(bad)).toThrow()
    expect(checkPlaceholderRequest({ ...request(1) })).toBeTruthy()
  })
  it("names a pocket's own set and code on a sheet that mixes sets", () => {
    const base = request(1).cards[0]
    const mixed = {
      ...request(1),
      setName: 'My binder',
      setCode: '',
      cards: [
        { ...base, setName: 'Legend of Blue Eyes White Dragon', setCode: 'LOB' },
        { ...base, imageId: 0, name: 'Any print' }
      ]
    }
    const html = placeholderHtml(checkPlaceholderRequest(mixed))
    expect(html).toContain('>Legend of Blue Eyes White Dragon</div>')
    expect(html).toContain('>LOB</div>')
    // The second pocket has no set of its own, no code to show and no art: just its name.
    expect(html).toContain('>My binder</div>')
    expect(html.match(/class="chip"/g)).toHaveLength(1)
    expect(html).not.toContain('ygo-img://full/0')
    expect(() => checkPlaceholderRequest({ ...mixed, cards: [{ ...base, setName: 5 }] })).toThrow()
  })
})
