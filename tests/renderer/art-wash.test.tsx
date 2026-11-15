import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { ArtWash } from '@/components/ArtWash'
import type { WashState } from '@/components/artWashContext'
import { resetWashStoreForTests } from '@/lib/washPref'
import { gameFallback } from '@/lib/wash/sample'
import { createMockApi } from './mockApi'

vi.mock('@/lib/friends', () => ({ useFriendsReady: () => false }))

const state = (strength = 1): WashState => ({ families: gameFallback('pkm'), seed: 7, strength })

const client = new QueryClient()
const wrap = (ui: ReactNode): ReactElement => (
  <QueryClientProvider client={client}>{ui}</QueryClientProvider>
)
const render = (ui: ReactNode): ReturnType<typeof rtlRender> => {
  const r = rtlRender(wrap(ui))
  return { ...r, rerender: (next: ReactNode) => r.rerender(wrap(next)) }
}

describe('ArtWash', () => {
  beforeEach(() => {
    localStorage.clear()
    resetWashStoreForTests()
  })
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
    localStorage.clear()
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

  it('draws nothing when disabled, even set to colourless', () => {
    localStorage.setItem('prefs:v1', JSON.stringify({ wash: { mode: 'colourless' } }))
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

  it('sets the --wash variables for the pinned header on desktop', () => {
    render(<ArtWash wash={state()} />)
    expect(document.documentElement.style.getPropertyValue('--wash-pools')).not.toBe('')
    expect(screen.getByTestId('wash-grain').style.mixBlendMode).toBe('overlay')
  })

  describe('on the phone', () => {
    const saved = window.api
    beforeEach(() => {
      window.api = createMockApi({ window: { platform: 'phone' } })
    })
    afterEach(() => {
      window.api = saved
    })

    it('is fixed still layers, with pool layers kept for the cross-fade', () => {
      render(<ArtWash wash={state()} />)
      const wash = screen.getByTestId('art-wash')
      expect(wash.className).toContain('fixed')
      expect(wash.style.transform).toBe('translateZ(0)')
      expect(screen.getByTestId('wash-a').style.willChange).toBe('opacity')
      expect(screen.getByTestId('wash-b').style.willChange).toBe('opacity')
    })

    it('draws the grain without a blend mode', () => {
      render(<ArtWash wash={state()} />)
      const grain = screen.getByTestId('wash-grain')
      expect(grain.style.mixBlendMode).toBe('')
      expect(grain.style.transform).toBe('translateZ(0)')
    })

    it('leaves the root variables alone, which only the desktop reads', () => {
      render(<ArtWash wash={state()} />)
      expect(document.documentElement.style.getPropertyValue('--wash-pools')).toBe('')
      expect(document.documentElement.style.getPropertyValue('--wash-base')).toBe('')
    })
  })

  it('colourless ignores the page wash', () => {
    localStorage.setItem('prefs:v1', JSON.stringify({ wash: { mode: 'colourless' } }))
    const { rerender } = render(<ArtWash wash={state(1)} />)
    const before = screen.getByTestId('wash-a').style.background
    expect(screen.getByTestId('wash-a').style.opacity).toBe('0.4')
    rerender(<ArtWash wash={{ ...state(1), seed: 99 }} />)
    expect(screen.getByTestId('wash-a').style.background).toBe(before)
    expect(screen.getByTestId('wash-a').style.opacity).toBe('0.4')
    expect(screen.getByTestId('wash-b').style.opacity).toBe('0')
  })
})
