import { scanArea } from '../../src/phone/stream/scanArea'

describe('scanArea', () => {
  it('marks the middle of a sideways frame', () => {
    expect(scanArea({ width: 1920, height: 1080 }, { width: 844, height: 390 })).toEqual({
      x: 244,
      y: 0,
      width: 356,
      height: 390
    })
  })
  it('cuts the crop to the view when it runs past it', () => {
    expect(scanArea({ width: 1080, height: 1920 }, { width: 390, height: 844 })).toEqual({
      x: 0,
      y: 106,
      width: 390,
      height: 633
    })
  })
  it('is the whole view before the video has a size', () => {
    expect(scanArea({ width: 0, height: 0 }, { width: 390, height: 844 })).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 844
    })
  })
})
