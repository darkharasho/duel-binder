import { render, screen } from '@testing-library/react'
import { ArtWash } from '@/components/ArtWash'
import type { WashState } from '@/components/artWashContext'
import { gameFallback } from '@/lib/wash/sample'

const state = (strength = 1): WashState => ({ families: gameFallback('pkm'), seed: 7, strength })

describe('ArtWash', () => {
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('shows the game fallback where there is no wash', () => {
    render(<ArtWash wash={null} />)
    expect(screen.getByTestId('wash-a').style.background).not.toBe('')
    expect(screen.getByTestId('wash-a').style.opacity).toBe('1')
  })

  it('cross-fades to the other layer when the wash changes', () => {
    const { rerender } = render(<ArtWash wash={null} />)
    rerender(<ArtWash wash={state()} />)
    expect(screen.getByTestId('wash-b').style.opacity).toBe('1')
    expect(screen.getByTestId('wash-a').style.opacity).toBe('0')
  })

  it('draws nothing when disabled', () => {
    const { container } = render(<ArtWash wash={null} enabled={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('drops the transition for reduced motion', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as never
    render(<ArtWash wash={null} />)
    expect(screen.getByTestId('wash-a').style.transition).toBe('none')
    expect(screen.getByTestId('wash-b').style.transition).toBe('none')
  })

  it('scales the visible layer by strength', () => {
    render(<ArtWash wash={state(0.5)} />)
    expect(screen.getByTestId('wash-a').style.opacity).toBe('0.5')
  })
})
