import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CardOutline } from '@/features/scan/CardOutline'
import type { Quad } from '@/features/scan/vision/detect'

const A: Quad = [
  [10, 10],
  [110, 10],
  [110, 160],
  [10, 160]
]
const B: Quad = [
  [30, 20],
  [130, 20],
  [130, 170],
  [30, 170]
]

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const polygon = (c: HTMLElement): SVGPolygonElement => c.querySelector('polygon')!

describe('CardOutline', () => {
  it('draws corner brackets while the card is read, the gold outline hidden', () => {
    const { container } = render(<CardOutline quad={A} width={360} height={480} locked={false} />)
    expect(container.querySelector('svg')).not.toHaveAttribute('data-locked')
    expect(polygon(container)).toHaveClass('opacity-0')
    expect(polygon(container)).toHaveAttribute('points', '10,10 110,10 110,160 10,160')
    // Four brackets, each from one side through its corner to the next.
    const d = container.querySelector('path')!.getAttribute('d')!
    expect(d.match(/M/g)).toHaveLength(4)
    expect(d).toContain('L10,10 L')
  })

  it('shows the gold outline once the card is added', () => {
    const { container } = render(<CardOutline quad={A} width={360} height={480} locked />)
    expect(container.querySelector('svg')).toHaveAttribute('data-locked', 'true')
    expect(polygon(container)).toHaveClass('opacity-100')
  })

  it('glides to a new detection instead of jumping', async () => {
    const { container, rerender } = render(
      <CardOutline quad={A} width={360} height={480} locked={false} />
    )
    rerender(<CardOutline quad={B} width={360} height={480} locked={false} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32)
    })
    const [x] = polygon(container).getAttribute('points')!.split(/[ ,]/).map(Number)
    expect(x).toBeGreaterThan(10)
    expect(x).toBeLessThan(30)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(polygon(container)).toHaveAttribute('points', '30,20 130,20 130,170 30,170')
  })
})
