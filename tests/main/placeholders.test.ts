import { describe, expect, it, vi } from 'vitest'
import { rarityChip, sheetCount, type PlaceholderRequest } from '../../src/shared/placeholders'

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
})
