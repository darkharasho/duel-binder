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

describe('Pokémon version colours', () => {
  it('colours foils, with Reverse Holofoil apart, and leaves the rest grey', () => {
    const gold = rarityColor('Holofoil', 'pkm')
    expect(gold).not.toBe('#9ca3af')
    expect(rarityColor('1st Edition Holofoil', 'pkm')).toBe(gold)
    expect(rarityColor('Shadowless Holofoil', 'pkm')).toBe(gold)
    const reverse = rarityColor('Reverse Holofoil', 'pkm')
    expect(reverse).not.toBe(gold)
    expect(reverse).not.toBe('#9ca3af')
    expect(rarityColor('Shadowless Reverse Holofoil', 'pkm')).toBe(reverse)
    expect(rarityColor('Normal', 'pkm')).toBe('#9ca3af')
    expect(rarityColor('1st Edition', 'pkm')).toBe('#9ca3af')
  })

  it('leaves Yu-Gi-Oh! unchanged', () => {
    expect(rarityColor('Holofoil')).toBe('#9ca3af')
    expect(rarityColor('Ultra Rare')).toBe('#e9c46a')
  })
})
