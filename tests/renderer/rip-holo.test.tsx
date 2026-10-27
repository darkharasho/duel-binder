import { render } from '@testing-library/react'
import { HoloCard } from '@/features/rip/HoloCard'
import type { RipCard } from '../../src/shared/rip/types'

const card = (over: Partial<RipCard>): RipCard => ({
  pkey: 'k',
  cardId: 1,
  name: 'Kuriboh',
  setCode: 'LOB-EN001',
  rarity: 'Ultra Rare',
  variant: null,
  frameType: 'normal',
  imageId: 5,
  slot: 0,
  ...over
})

const holo = (c: Container): HTMLElement | null => c.querySelector('[data-holo]')
type Container = HTMLElement

describe('HoloCard', () => {
  it('Secret Rare gets an art-box holo layer', () => {
    const { container } = render(<HoloCard card={card({ rarity: 'Secret Rare' })} size="full" />)
    const layer = holo(container)!
    expect(layer).toHaveAttribute('data-holo', 'art')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer.style.top).toBe('18.1%')
    expect(layer.style.left).toBe('11.9%')
    expect(layer.style.right).toBe('11.9%')
    expect(layer.style.bottom).toBe('29.6%')
  })

  it('holo position is class-driven so reduced motion can pin it', () => {
    const { container } = render(<HoloCard card={card({ rarity: 'Secret Rare' })} size="full" />)
    const layer = holo(container)!
    expect(layer.style.backgroundPosition).toBe('')
    expect(layer.className).toContain('motion-reduce:[background-position:50%_50%]')
    expect(layer.className).toContain('[background-position:var(--glare-x,50%)_var(--glare-y,50%)]')
  })

  it('Starlight Rare gets a whole-card holo layer', () => {
    const { container } = render(<HoloCard card={card({ rarity: 'Starlight Rare' })} size="full" />)
    const layer = holo(container)!
    expect(layer).toHaveAttribute('data-holo', 'full')
    expect(layer.style.top).toBe('0px')
  })

  it('Ultra Rare gets no holo', () => {
    const { container } = render(<HoloCard card={card({})} size="small" />)
    expect(holo(container)).toBeNull()
  })

  it('Pendulum Secret uses the pendulum box', () => {
    const { container } = render(
      <HoloCard card={card({ rarity: 'Secret Rare', frameType: 'effect_pendulum' })} size="full" />
    )
    expect(holo(container)!.style.left).toBe('6.4%')
    expect(holo(container)!.style.bottom).toBe('38%')
  })

  it('shows the standard card image', () => {
    const { container } = render(<HoloCard card={card({})} size="full" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'ygo-img://full/5')
  })
})
