// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { appFrame } from './scan-app-frame'

/** An image whose every pixel holds its own x in R and y in G. */
function grid(
  width: number,
  height: number
): {
  width: number
  height: number
  data: Uint8ClampedArray
} {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([x, y, 0, 255], (y * width + x) * 4)
  return { width, height, data }
}

describe('appFrame', () => {
  it('takes the same pixels as the live scan from a landscape photo', () => {
    const out = appFrame(grid(192, 108))
    expect([out.width, out.height]).toEqual([81, 108])
    expect([...out.data.subarray(0, 2)]).toEqual([55, 0])
    expect([...out.data.subarray(-4, -2)]).toEqual([135, 107])
  })

  it('takes a centre band of a photo narrower than the preview', () => {
    const out = appFrame(grid(48, 108))
    expect([out.width, out.height]).toEqual([48, 64])
    expect([...out.data.subarray(0, 2)]).toEqual([0, 22])
  })

  it('takes the exact rectangle at full size', () => {
    expect(
      appFrame({ width: 1920, height: 1080, data: new Uint8ClampedArray(1920 * 1080 * 4) })
    ).toMatchObject({ width: 810, height: 1080 })
  })
})
