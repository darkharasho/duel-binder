import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createFrameTimes, type FrameTiming } from '@/features/scan/frameTimes'
import { ScanTimingsReadout, ScanTimingsToggle } from '../../src/phone/ScanTimings'
import { scanTimingsOn } from '../../src/phone/scanTimingsSetting'

const frame = (ms: number): FrameTiming => ({
  grab: ms,
  pixels: ms,
  vision: ms,
  ocr: 0,
  wait: 0,
  lookup: ms,
  outline: ms,
  every: ms
})

describe('scan timings', () => {
  beforeEach(() => localStorage.clear())

  it('reads out the median of the last ten frames', () => {
    const times = createFrameTimes()
    expect(times.push(frame(100)).vision).toBe(100)
    times.push(frame(900))
    expect(times.push(frame(120)).vision).toBe(120)
    // Ten frames of 50 push the old ones out.
    let out = frame(0)
    for (let i = 0; i < 10; i++) out = times.push(frame(50))
    expect(out.vision).toBe(50)
  })

  it('the Settings switch is remembered on the device', () => {
    expect(scanTimingsOn()).toBe(false)
    render(<ScanTimingsToggle />)
    fireEvent.click(screen.getByRole('checkbox', { name: /show scan timings/i }))
    expect(scanTimingsOn()).toBe(true)
  })

  it('shows dashes before the first frame, then the times', () => {
    const { rerender } = render(<ScanTimingsReadout timing={null} />)
    expect(screen.getByLabelText('Scan timings')).toHaveTextContent('vision–')
    rerender(<ScanTimingsReadout timing={frame(42)} />)
    expect(screen.getByLabelText('Scan timings')).toHaveTextContent('vision42')
  })
})
