import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrast, type RGB } from '@/lib/wash/color'

const css = readFileSync('src/renderer/src/index.css', 'utf8')
const token = (name: string): RGB => {
  const hex = new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i').exec(css)![1]
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB
}

describe('colour tokens', () => {
  it('destructive buttons read at AA with their ink', () => {
    expect(contrast(token('destructive'), token('chip-on-ink'))).toBeGreaterThanOrEqual(4.5)
  })
  it('buttons and badges use that ink on the destructive fill', () => {
    for (const f of ['button', 'badge']) {
      const src = readFileSync(`src/renderer/src/components/ui/${f}.tsx`, 'utf8')
      expect(src).toMatch(/bg-destructive text-chip-on-ink/)
    }
  })
})
