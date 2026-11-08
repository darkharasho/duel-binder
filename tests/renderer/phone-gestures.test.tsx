import { useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { CardSheet } from '@/components/CardSheet'
import { PanelCardArt } from '@/components/PanelCardArt'
import type { PanelNav } from '@/components/panelNav'
import { createMockApi, renderWithProviders } from './mockApi'

/** jsdom gives elements no size, so the sheet measures the window: 1024px wide. */
const WIDTH = window.innerWidth

/**
 * A one-finger drag from `from` to `to` in a few moves, 50ms apart on a mocked clock, so its
 * speed (under the flick threshold) is known.
 */
function swipe(el: Element, from: [number, number], to: [number, number], moves = 5): void {
  let now = 1000
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  const at = (x: number, y: number): { touches: object[]; changedTouches: object[] } => ({
    touches: [{ clientX: x, clientY: y }],
    changedTouches: [{ clientX: x, clientY: y }]
  })
  try {
    fireEvent.touchStart(el, at(...from))
    for (let i = 1; i <= moves; i++) {
      now += 50
      const x = from[0] + ((to[0] - from[0]) * i) / moves
      const y = from[1] + ((to[1] - from[1]) * i) / moves
      fireEvent.touchMove(el, at(x, y))
    }
    fireEvent.touchEnd(el, { touches: [], changedTouches: [{ clientX: to[0], clientY: to[1] }] })
  } finally {
    clock.mockRestore()
  }
}

/** A one-finger drag through `points`, 16ms apart (a 60fps flick), lifting at the last. */
function drag(el: Element, points: [number, number][]): void {
  let now = 1000
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  const at = ([x, y]: [number, number]): { touches: object[]; changedTouches: object[] } => ({
    touches: [{ clientX: x, clientY: y }],
    changedTouches: [{ clientX: x, clientY: y }]
  })
  try {
    fireEvent.touchStart(el, at(points[0]))
    for (const p of points.slice(1)) {
      now += 16
      fireEvent.touchMove(el, at(p))
    }
    const last = points[points.length - 1]
    fireEvent.touchEnd(el, { touches: [], changedTouches: at(last).changedTouches })
  } finally {
    clock.mockRestore()
  }
}

function renderSheet(
  platform: 'phone' | 'linux',
  nav: PanelNav | undefined,
  onClose = vi.fn()
): { onClose: ReturnType<typeof vi.fn>; sheet: HTMLElement } {
  renderWithProviders(
    <CardSheet onClose={onClose}>
      <PanelCardArt imageId={101} alt="Dark Magician" nav={nav} />
      <input type="range" aria-label="Slider" />
    </CardSheet>,
    { api: createMockApi({ window: { platform } }) }
  )
  return { onClose, sheet: screen.getByRole('dialog') }
}

describe('phone card swipes', () => {
  it('an edge swipe past the threshold goes back', async () => {
    const { onClose, sheet } = renderSheet('phone', undefined)
    swipe(sheet, [5, 300], [5 + WIDTH * 0.5, 310])
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('a short edge swipe springs back without going back', async () => {
    const { onClose, sheet } = renderSheet('phone', undefined)
    // Slowly: 10px per 50ms, well under a flick.
    swipe(sheet, [5, 300], [5 + WIDTH * 0.2, 300], 20)
    await new Promise((r) => setTimeout(r, 300))
    expect(onClose).not.toHaveBeenCalled()
    expect(sheet.style.transform).toBe('')
  })

  it('a mostly vertical drag from the edge is left to scrolling', async () => {
    const { onClose, sheet } = renderSheet('phone', undefined)
    swipe(sheet, [5, 100], [5 + WIDTH * 0.4, 700])
    await new Promise((r) => setTimeout(r, 300))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a quick thumb flick up the drawer that starts sideways at the edge does not go back', async () => {
    const { onClose, sheet } = renderSheet('phone', undefined)
    // A thumb's arc: sideways first (so it locks as an edge swipe), then up the drawer.
    drag(sheet, [
      [8, 600],
      [24, 598],
      [40, 540],
      [55, 440],
      [70, 320]
    ])
    await new Promise((r) => setTimeout(r, 300))
    expect(onClose).not.toHaveBeenCalled()
    expect(sheet.style.transform).toBe('')
  })

  it('a short quick flick from the edge does not go back', async () => {
    const { onClose, sheet } = renderSheet('phone', undefined)
    drag(sheet, [
      [8, 300],
      [28, 301],
      [50, 302]
    ])
    await new Promise((r) => setTimeout(r, 300))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a long quick flick from the edge still goes back', async () => {
    const { onClose, sheet } = renderSheet('phone', undefined)
    drag(sheet, [
      [8, 300],
      [60, 302],
      [120, 304],
      [180, 306]
    ])
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('swiping right from the card’s left edge steps back instead of closing', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    const { onClose, sheet } = renderSheet('phone', nav)
    vi.useFakeTimers()
    try {
      // The Pokémon card starts ~16px in; a swipe from just inside it is the card's, not the edge's.
      swipe(sheet, [24, 300], [600, 300])
      vi.advanceTimersByTime(200)
      expect(nav.prev).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('swiping left steps to the next card and right to the previous', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    const { onClose, sheet } = renderSheet('phone', nav)
    vi.useFakeTimers()
    try {
      swipe(sheet, [700, 300], [200, 300])
      vi.advanceTimersByTime(200)
      expect(nav.next).toHaveBeenCalledTimes(1)
      expect(nav.prev).not.toHaveBeenCalled()
      swipe(sheet, [200, 300], [700, 300])
      vi.advanceTimersByTime(200)
      expect(nav.prev).toHaveBeenCalledTimes(1)
      expect(nav.next).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the card follows the finger, slides off, and the next one slides in from the far side', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    const { sheet } = renderSheet('phone', nav)
    const page = screen.getByRole('slider', { name: 'Slider' }).parentElement!
    const one = (x: number): { touches: object[]; changedTouches: object[] } => ({
      touches: [{ clientX: x, clientY: 300 }],
      changedTouches: [{ clientX: x, clientY: 300 }]
    })
    fireEvent.touchStart(sheet, one(700))
    fireEvent.touchMove(sheet, one(650))
    fireEvent.touchMove(sheet, one(400))
    expect(page.style.transform).toMatch(/^translateX\(-/)
    expect(page.style.opacity).toBe('')
    vi.useFakeTimers()
    try {
      swipe(sheet, [700, 300], [200, 300])
      // It carries on off to the left before the next card is shown.
      expect(nav.next).not.toHaveBeenCalled()
      expect(page.style.transform).toMatch(/^translateX\(-/)
      // A second swipe while it leaves is ignored.
      swipe(sheet, [700, 300], [200, 300])
      vi.advanceTimersByTime(200)
      expect(nav.next).toHaveBeenCalledTimes(1)
      expect(page.style.transition).toContain('transform 280ms')
      expect(page.style.transform).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the next card is on the page before it slides in', () => {
    // A page whose step changes the open card, as the real pages do.
    function Steps(): React.JSX.Element {
      const [n, setN] = useState(1)
      return (
        <CardSheet onClose={vi.fn()}>
          <PanelCardArt imageId={100 + n} alt={`Card ${n}`} nav={{ next: () => setN(n + 1) }} />
          <p>Showing card {n}</p>
        </CardSheet>
      )
    }
    renderWithProviders(<Steps />, { api: createMockApi({ window: { platform: 'phone' } }) })
    const sheet = screen.getByRole('dialog')
    vi.useFakeTimers()
    try {
      swipe(sheet, [700, 300], [200, 300])
      // Outside act, so nothing renders unless the step does so itself before the slide starts.
      vi.advanceTimersByTime(200)
      expect(screen.getByText('Showing card 2')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a short swipe across the card does not step', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    const { sheet } = renderSheet('phone', nav)
    swipe(sheet, [600, 300], [500, 300], 10)
    expect(nav.next).not.toHaveBeenCalled()
  })

  it('swiping past the ends does nothing', () => {
    const prev = vi.fn()
    const { onClose, sheet } = renderSheet('phone', { prev })
    // The last card: no next.
    swipe(sheet, [700, 300], [100, 300])
    expect(prev).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a swipe starting on a slider is the slider’s', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    renderSheet('phone', nav)
    swipe(screen.getByRole('slider', { name: 'Slider' }), [700, 300], [100, 300])
    expect(nav.next).not.toHaveBeenCalled()
  })

  it('keeps the arrows on the phone for screen readers only', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    renderSheet('phone', nav)
    // Exactly one pair, outside both layouts, so it's there at every width and announced once.
    expect(screen.getAllByRole('button', { name: 'Next card' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Previous card' })).toHaveLength(1)
    const next = screen.getByRole('button', { name: 'Next card' })
    const prev = screen.getByRole('button', { name: 'Previous card' })
    expect(next.closest('.min-\\[900px\\]\\:hidden, .min-\\[900px\\]\\:flex')).toBeNull()
    expect(next).toHaveClass('sr-only')
    expect(prev).toHaveClass('sr-only')
    fireEvent.click(next)
    expect(nav.next).toHaveBeenCalledTimes(1)
  })

  it('a second finger mid-swipe settles the card back', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    renderSheet('phone', nav)
    const page = screen.getByRole('slider', { name: 'Slider' }).parentElement!
    const sheet = screen.getByRole('dialog')
    const one = (x: number): { touches: object[]; changedTouches: object[] } => ({
      touches: [{ clientX: x, clientY: 300 }],
      changedTouches: [{ clientX: x, clientY: 300 }]
    })
    fireEvent.touchStart(sheet, one(700))
    fireEvent.touchMove(sheet, one(650))
    fireEvent.touchMove(sheet, one(500))
    expect(page.style.transform).toBe('translateX(-200px)')
    fireEvent.touchStart(sheet, {
      touches: [
        { clientX: 500, clientY: 300 },
        { clientX: 200, clientY: 300 }
      ],
      changedTouches: [{ clientX: 200, clientY: 300 }]
    })
    expect(page.style.transform).toBe('')
    expect(nav.next).not.toHaveBeenCalled()
  })

  it('the same for an edge swipe: a second finger settles the sheet back', () => {
    const { onClose, sheet } = renderSheet('phone', undefined)
    const one = (x: number): { touches: object[]; changedTouches: object[] } => ({
      touches: [{ clientX: x, clientY: 300 }],
      changedTouches: [{ clientX: x, clientY: 300 }]
    })
    fireEvent.touchStart(sheet, one(10))
    fireEvent.touchMove(sheet, one(60))
    fireEvent.touchMove(sheet, one(210))
    expect(sheet.style.transform).toBe('translateX(200px)')
    fireEvent.touchStart(sheet, {
      touches: [
        { clientX: 210, clientY: 300 },
        { clientX: 400, clientY: 300 }
      ],
      changedTouches: [{ clientX: 400, clientY: 300 }]
    })
    expect(sheet.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a swipe in a row that scrolls sideways is the row’s', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    renderWithProviders(
      <CardSheet onClose={vi.fn()}>
        <PanelCardArt imageId={101} alt="Dark Magician" nav={nav} />
        <div data-testid="row" className="flex max-md:overflow-x-auto">
          <span>wide</span>
        </div>
      </CardSheet>,
      { api: createMockApi({ window: { platform: 'phone' } }) }
    )
    const row = screen.getByTestId('row')
    Object.defineProperty(row, 'scrollWidth', { value: 900 })
    Object.defineProperty(row, 'clientWidth', { value: 300 })
    swipe(screen.getByText('wide'), [700, 300], [100, 300])
    expect(nav.next).not.toHaveBeenCalled()
  })

  it('keeps the arrows on desktop, and swipes do nothing there', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    const { onClose, sheet } = renderSheet('linux', nav)
    expect(screen.getAllByRole('button', { name: 'Next card' }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Next card' })[0])
    expect(nav.next).toHaveBeenCalledTimes(1)
    swipe(sheet, [700, 300], [100, 300])
    swipe(sheet, [5, 300], [800, 300])
    expect(nav.next).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })
  it('floats the phone card over a blurred glow of its own art, hidden from screen readers', () => {
    renderSheet('phone', undefined)
    const glow = screen.getByTestId('card-glow')
    expect(glow).toHaveAttribute('aria-hidden', 'true')
    expect(glow.className).toContain('blur')
    expect(screen.getAllByRole('img', { name: /Dark Magician/ })).toHaveLength(1)
  })

  it('has no glow on desktop', () => {
    renderSheet('linux', undefined)
    expect(screen.queryByTestId('card-glow')).toBeNull()
  })
})
