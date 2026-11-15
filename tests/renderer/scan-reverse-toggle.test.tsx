import { fireEvent, render, screen } from '@testing-library/react'
import { FoilToggle } from '@/features/scan/FoilToggle'
import { reverseTwin } from '@/features/scan/reverseCheck'
import { printing } from './scanFakes'

const pk = (printingId: number, rarity: string, o: Partial<Parameters<typeof printing>[0]> = {}) =>
  printing({
    printingId,
    cardId: 9,
    name: 'Pikachu',
    setCode: 'SV1 025',
    setName: 'Scarlet & Violet',
    rarity,
    ...o
  })
const NORMAL = pk(1, 'Normal')
const HOLO = pk(2, 'Holofoil')
const REVERSE = pk(3, 'Reverse Holofoil')
const BALL = pk(4, 'Poke Ball Pattern')

describe('reverseTwin', () => {
  it('pairs a Normal or Holofoil with its Reverse Holofoil', () => {
    expect(reverseTwin(NORMAL, [NORMAL, REVERSE])?.printingId).toBe(3)
    expect(reverseTwin(HOLO, [HOLO, REVERSE])?.printingId).toBe(3)
  })

  it('pairs a Reverse Holofoil with the Normal, else the Holofoil', () => {
    expect(reverseTwin(REVERSE, [REVERSE, HOLO, NORMAL])?.printingId).toBe(1)
    expect(reverseTwin(REVERSE, [REVERSE, HOLO])?.printingId).toBe(2)
  })

  it('has no twin without a counterpart, and ignores patterns and stamps', () => {
    expect(reverseTwin(NORMAL, [NORMAL, BALL])).toBeNull()
    expect(reverseTwin(REVERSE, [REVERSE, BALL])).toBeNull()
    expect(reverseTwin(BALL, [BALL, REVERSE, NORMAL])).toBeNull()
  })

  it('needs the same card, set code and language', () => {
    expect(reverseTwin(NORMAL, [NORMAL, pk(5, 'Reverse Holofoil', { cardId: 10 })])).toBeNull()
    expect(
      reverseTwin(NORMAL, [NORMAL, pk(5, 'Reverse Holofoil', { setCode: 'SV2 025' })])
    ).toBeNull()
    expect(reverseTwin(NORMAL, [NORMAL, pk(5, 'Reverse Holofoil', { language: 'ja' })])).toBeNull()
  })
})

describe('the Pokémon RH toggle', () => {
  const row = (printingId: number | null, options = [NORMAL, REVERSE]) => ({
    game: 'pkm' as const,
    printingId,
    options
  })

  it('switches to the reverse holo and back, with pressed state', () => {
    const onPick = vi.fn()
    const { rerender } = render(<FoilToggle row={row(1)} onPick={onPick} />)
    const button = screen.getByRole('button', { name: 'Reverse holo' })
    expect(button).toHaveTextContent('RH')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(onPick).toHaveBeenLastCalledWith(3)

    rerender(<FoilToggle row={row(3)} onPick={onPick} />)
    const on = screen.getByRole('button', { name: 'Reverse holo' })
    expect(on).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(on)
    expect(onPick).toHaveBeenLastCalledWith(1)
  })

  it('hides without a twin, for a pattern, or with no printing', () => {
    const { container, rerender } = render(<FoilToggle row={row(1, [NORMAL])} onPick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<FoilToggle row={row(4, [BALL, REVERSE])} onPick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<FoilToggle row={row(null)} onPick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays hidden for other games', () => {
    const { container } = render(
      <FoilToggle row={{ ...row(1), game: undefined }} onPick={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
