import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitScreen } from '../../src/phone/screenHeight'

const root = document.documentElement

function phone(standalone: boolean | undefined, landscape = false): void {
  vi.stubGlobal('navigator', { ...navigator, standalone })
  vi.stubGlobal('screen', { width: 393, height: 852 })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('landscape') && landscape }))
  vi.stubGlobal('innerHeight', landscape ? 340 : 793)
}

describe('fitScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    root.style.removeProperty('--app-height')
  })

  it('sizes an iPhone home-screen app to the screen, not the short viewport', () => {
    phone(true)
    fitScreen()
    expect(root.style.getPropertyValue('--app-height')).toBe('852px')
  })

  it('uses the short side in landscape', () => {
    phone(true, true)
    fitScreen()
    expect(root.style.getPropertyValue('--app-height')).toBe('393px')
  })

  it('leaves browser tabs and Android alone', () => {
    phone(undefined)
    fitScreen()
    expect(root.style.getPropertyValue('--app-height')).toBe('')
  })
})
