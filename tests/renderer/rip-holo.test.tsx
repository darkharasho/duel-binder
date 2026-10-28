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

  it('Secret foil is drawn by the stylesheet, so the glare and reduced motion drive it there', () => {
    const { container } = render(<HoloCard card={card({ rarity: 'Secret Rare' })} size="full" />)
    const layer = holo(container)!
    expect(layer).toHaveAttribute('data-foil', 'secret')
    expect(layer).toHaveClass('rip-foil', 'rip-foil-secret')
    expect(layer.style.backgroundImage).toBe('')
    expect(layer.style.backgroundPosition).toBe('')
    expect(layer.style.maskImage).toBe('')
  })

  it('Secret Rare also gets a foil name, inked to suit the frame', () => {
    const { container } = render(<HoloCard card={card({ rarity: 'Secret Rare' })} size="full" />)
    const name = container.querySelector<HTMLElement>('[data-foil="name"]')!
    expect(name).toHaveClass('rip-foil', 'rip-foil-name')
    expect(name).toHaveAttribute('data-ink', 'dark')
    expect(name.style.top).toBe('4.1%')
    expect(name.style.right).toBe('17.8%')

    const { container: xyz } = render(
      <HoloCard card={card({ rarity: 'Secret Rare', frameType: 'xyz' })} size="full" />
    )
    expect(xyz.querySelector('[data-foil="name"]')).toHaveAttribute('data-ink', 'light')
  })

  it('Starlight Rare gets the glittery foil and the prism over the whole card', () => {
    const { container } = render(<HoloCard card={card({ rarity: 'Starlight Rare' })} size="full" />)
    const layer = holo(container)!
    expect(layer).toHaveAttribute('data-holo', 'full')
    expect(layer).toHaveAttribute('data-foil', 'starlight')
    expect(layer).toHaveClass('rip-foil-starlight', 'rounded-[6px]')
    expect(layer.style.top).toBe('0px')
    const prism = container.querySelector<HTMLElement>('[data-foil="prism"]')!
    expect(prism).toHaveClass('rip-foil-prism')
    expect(prism.style.bottom).toBe('0px')
    expect(container.querySelector('[data-foil="name"]')).not.toBeNull()
  })

  it('an Overframe Secret keeps the Secret foil, over the whole card', () => {
    const { container } = render(
      <HoloCard card={card({ rarity: 'Secret Rare', variant: 'Overframe' })} size="full" />
    )
    const layer = holo(container)!
    expect(layer).toHaveAttribute('data-foil', 'secret')
    expect(layer.style.top).toBe('0px')
    expect(container.querySelector('[data-foil="prism"]')).toBeNull()
  })

  it('soft sheen position is class-driven so reduced motion can pin it', () => {
    const { container } = render(<HoloCard card={card({ rarity: 'Ultra Rare' })} size="full" />)
    const layer = holo(container)!
    expect(layer.style.backgroundPosition).toBe('')
    expect(layer.className).toContain('motion-reduce:[background-position:50%_50%]')
    expect(layer.className).toContain('[background-position:var(--glare-x,50%)_var(--glare-y,50%)]')
    expect(container.querySelector('[data-foil]')).toBeNull()
  })

  it('Super and Ultra Rare get the soft sheen over the art, unmasked', () => {
    for (const rarity of ['Super Rare', 'Ultra Rare']) {
      const { container, unmount } = render(<HoloCard card={card({ rarity })} size="full" />)
      const layer = holo(container)!
      expect(layer).toHaveAttribute('data-holo', 'soft')
      expect(layer.style.top).toBe('18.1%')
      expect(layer.style.maskImage).toBe('')
      unmount()
    }
  })

  it('a glow goes on the part that tilts, so it leans with the card', () => {
    const { container } = render(
      <HoloCard card={card({ rarity: 'Super Rare' })} size="full" shadow="0 0 40px red" />
    )
    const tilting = container.querySelector<HTMLElement>('.group\\/tilt')!
    expect(tilting.style.boxShadow).toBe('0 0 40px red')
    expect((container.firstChild as HTMLElement).style.boxShadow).toBe('')
  })

  it('a plain Rare gets no holo', () => {
    const { container } = render(<HoloCard card={card({ rarity: 'Rare' })} size="small" />)
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
