import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SmoothVideo, drawSize } from '@/features/scan/SmoothVideo'

describe('drawSize', () => {
  it('draws a 4K frame at the pixels a 1080p box shows of it', () => {
    expect(drawSize(3840, 2160, 1920, 1080, 'cover')).toEqual({ width: 1920, height: 1080 })
    expect(drawSize(3840, 2160, 1920, 1080, 'contain')).toEqual({ width: 1920, height: 1080 })
  })

  it('covers a box of another shape by its longer side, and fits inside it by its shorter', () => {
    // A portrait 810x1080 box: covered, the frame's height fills it and its sides run past.
    expect(drawSize(3840, 2160, 810, 1080, 'cover')).toEqual({ width: 1920, height: 1080 })
    expect(drawSize(3840, 2160, 810, 1080, 'contain')).toEqual({ width: 810, height: 456 })
  })

  it('never draws more pixels than the frame has, zoomed in as far as it goes', () => {
    expect(drawSize(3840, 2160, 1920 * 3, 1080 * 3, 'cover')).toEqual({ width: 3840, height: 2160 })
  })
})

describe('SmoothVideo', () => {
  it('keeps the video for the scan loop, and shows it while nothing is drawn', () => {
    const ref = createRef<HTMLVideoElement>()
    render(<SmoothVideo videoRef={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLVideoElement)
    expect(ref.current).toBeVisible()
    // jsdom has no 2D canvas, so the canvas never draws and stays hidden.
    expect(screen.getByTestId('smooth-video')).toHaveClass('invisible')
  })
})
