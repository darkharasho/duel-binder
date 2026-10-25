import { rarityColor, rarityTextColor } from '@/lib/rarityColors'

describe('rarityTextColor', () => {
  it('uses white on dark backgrounds and dark text on light ones', () => {
    expect(rarityTextColor('Common')).toBe('#ffffff')
    expect(rarityTextColor('Ultra Rare')).toBe('#18181b')
    expect(rarityTextColor('Rare')).toBe('#18181b')
    expect(rarityColor('Nonexistent')).toBe('#9ca3af')
    expect(rarityTextColor('Nonexistent')).toBe('#18181b')
  })
})
