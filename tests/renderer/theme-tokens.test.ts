import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../../src/renderer/src/index.css'), 'utf8')

describe('theme tokens', () => {
  it('uses Bricolage Grotesque as the sans font', () => {
    expect(css).toMatch(/--font-sans:[^;]*Bricolage Grotesque Variable/)
  })
  it('keeps muted text the same colour as foreground', () => {
    expect(css).toMatch(/--muted-foreground:\s*#ffffff/)
  })
  it('keeps the popover solid', () => {
    expect(css).toMatch(/--popover:\s*#[0-9a-f]{6}/i)
    expect(css).not.toMatch(/--popover:\s*transparent/)
  })
  it('defines font-display as condensed', () => {
    const block = css.match(/\.font-display\s*\{[^}]*\}/)
    expect(block?.[0]).toContain('font-stretch: 75%')
  })
})
