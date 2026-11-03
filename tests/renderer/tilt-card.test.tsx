import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TiltCard } from '@/components/TiltCard'

function setup(touch: boolean): { outer: HTMLElement; inner: HTMLElement } {
  render(
    <TiltCard touch={touch}>
      <span>card</span>
    </TiltCard>
  )
  const inner = screen.getByText('card').parentElement!
  return { outer: inner.parentElement!, inner }
}

const finger = { pointerType: 'touch', clientX: 10, clientY: 10 }

describe('TiltCard', () => {
  it('tilts under a finger held on the card when touch is on, and settles when it lifts', async () => {
    const { outer, inner } = setup(true)
    fireEvent.pointerDown(outer, finger)
    fireEvent.pointerMove(outer, { ...finger, clientX: 5 })
    await waitFor(() => expect(inner.dataset.tilting).toBe(''))
    fireEvent.pointerUp(outer, finger)
    expect(inner.dataset.tilting).toBeUndefined()
    expect(inner.style.getPropertyValue('--tilt-x')).toBe('')
  })

  it('ignores a finger without touch, as on desktop', async () => {
    const { outer, inner } = setup(false)
    fireEvent.pointerDown(outer, finger)
    fireEvent.pointerMove(outer, finger)
    await new Promise((r) => setTimeout(r, 30))
    expect(inner.dataset.tilting).toBeUndefined()
  })

  it('lets go when the page takes the touch for a scroll', async () => {
    const { outer, inner } = setup(true)
    fireEvent.pointerDown(outer, finger)
    await waitFor(() => expect(inner.dataset.tilting).toBe(''))
    fireEvent.pointerCancel(outer, finger)
    fireEvent.pointerMove(outer, finger)
    await new Promise((r) => setTimeout(r, 30))
    expect(inner.dataset.tilting).toBeUndefined()
  })
})
