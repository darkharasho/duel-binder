import { describe, expect, it } from 'vitest'
import { centreCrop } from '@/features/scan/crop'

describe('centreCrop', () => {
  it('takes the centre portrait slice of a 16:9 frame', () => {
    expect(centreCrop(1920, 1080)).toEqual({ x: 555, y: 0, width: 810, height: 1080 })
    expect(centreCrop(1280, 720)).toEqual({ x: 370, y: 0, width: 540, height: 720 })
  })

  it('takes the centre portrait slice of a 4:3 frame', () => {
    expect(centreCrop(640, 480)).toEqual({ x: 140, y: 0, width: 360, height: 480 })
  })

  it('takes a centre band of a frame narrower than the preview', () => {
    expect(centreCrop(480, 1080)).toEqual({ x: 0, y: 220, width: 480, height: 640 })
  })
})
