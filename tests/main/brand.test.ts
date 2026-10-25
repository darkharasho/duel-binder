import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pngSize = (file: string): [number, number] => {
  const b = readFileSync(file)
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}
const icoSizes = (file: string): number[] => {
  const b = readFileSync(file)
  const count = b.readUInt16LE(4)
  return Array.from({ length: count }, (_, i) => b[6 + i * 16] || 256)
}

describe('brand assets', () => {
  const cases: [string, number, number][] = [
    ['build/icon.png', 1024, 1024],
    ['resources/icon.png', 512, 512],
    ['resources/brand/discord-icon.png', 1024, 1024],
    ['workers/portal/site/apple-touch-icon.png', 180, 180],
    ['workers/portal/site/og.png', 1200, 630]
  ]
  it.each(cases)('%s is %ix%i', (file, w, h) => expect(pngSize(file)).toEqual([w, h]))
  it('favicon.ico holds 16, 32 and 48', () =>
    expect(icoSizes('workers/portal/site/favicon.ico')).toEqual([16, 32, 48]))
  it('svg sources are self-contained', () => {
    for (const f of ['square', 'circle', 'small'])
      expect(readFileSync(`resources/brand/${f}.svg`, 'utf8')).toMatch(/<linearGradient id="au"/)
  })
})
