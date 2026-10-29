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

  it('swiping left steps to the next card and right to the previous', () => {
    const nav = { prev: vi.fn(), next: vi.fn() }
    const { onClose, sheet } = renderSheet('phone', nav)
    swipe(sheet, [700, 300], [200, 300])
    expect(nav.next).toHaveBeenCalledTimes(1)
    expect(nav.prev).not.toHaveBeenCalled()
    swipe(sheet, [200, 300], [700, 300])
    expect(nav.prev).toHaveBeenCalledTimes(1)
    expect(nav.next).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
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

  it('hides the arrows on the phone', () => {
    renderSheet('phone', { prev: vi.fn(), next: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Next card' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous card' })).not.toBeInTheDocument()
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
})
