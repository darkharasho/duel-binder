import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { CardArt } from '@/components/CardArt'
import { cardArtUrl, coverArtUrl, setArtUrl } from '@/components/artWashContext'
import { cardImageSrc, printingImageSrc, setImageSrc } from '@/lib/images'
import { isMac, isPhone, isWeb } from '@/lib/platform'
import { createMockApi } from './mockApi'

function usePlatformApi(platform: string): void {
  window.api = createMockApi({ window: { platform } })
}

describe('image URL helpers', () => {
  it('builds ygo-img:// URLs on desktop', () => {
    usePlatformApi('linux')
    expect(cardImageSrc('small', 12)).toBe('ygo-img://small/12')
    expect(printingImageSrc(5)).toBe('ygo-img://printing/5')
    expect(setImageSrc('LOB')).toBe('ygo-img://set/LOB')
  })

  it('builds /img/ URLs on the web', () => {
    usePlatformApi('web')
    expect(cardImageSrc('small', 12)).toBe('/img/small/12')
    expect(cardImageSrc('cropped', 3)).toBe('/img/cropped/3')
    expect(printingImageSrc(5)).toBe('/img/printing/5')
    expect(setImageSrc('LOB')).toBe('/img/set/LOB')
  })

  it('builds /img/ URLs on the phone, with no printing scans', () => {
    usePlatformApi('phone')
    expect(cardImageSrc('small', 12)).toBe('/img/small/12')
    expect(printingImageSrc(5)).toBeNull()
    expect(setImageSrc('LOB')).toBe('/img/set/LOB')
  })

  it('artWashContext URLs delegate to the helpers', () => {
    usePlatformApi('web')
    expect(cardArtUrl(1)).toBe('/img/small/1')
    expect(coverArtUrl(2)).toBe('/img/cropped/2')
    expect(setArtUrl('X')).toBe('/img/set/X')
  })

  it('renders CardArt with a /img/ src on the web', () => {
    usePlatformApi('web')
    render(createElement(CardArt, { imageId: 12, size: 'small', alt: 'Kuriboh' }))
    expect(screen.getByAltText('Kuriboh')).toHaveAttribute('src', '/img/small/12')
  })
})

describe('platform helpers', () => {
  it('isWeb reflects the api platform', () => {
    usePlatformApi('web')
    expect(isWeb()).toBe(true)
    usePlatformApi('linux')
    expect(isWeb()).toBe(false)
  })

  it('the phone counts as the web, and only the phone is the phone', () => {
    usePlatformApi('phone')
    expect(isWeb()).toBe(true)
    expect(isPhone()).toBe(true)
    usePlatformApi('web')
    expect(isPhone()).toBe(false)
    usePlatformApi('linux')
    expect(isPhone()).toBe(false)
  })

  it('isMac is darwin on desktop and user-agent based on the web', () => {
    usePlatformApi('darwin')
    expect(isMac()).toBe(true)
    usePlatformApi('linux')
    expect(isMac()).toBe(false)
    usePlatformApi('web')
    const ua = vi.spyOn(navigator, 'userAgent', 'get')
    ua.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(isMac()).toBe(true)
    ua.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)')
    expect(isMac()).toBe(false)
    ua.mockRestore()
  })
})
