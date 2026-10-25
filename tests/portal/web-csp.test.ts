import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WEB_CSP } from '../../workers/portal/src/home'

describe('web CSP', () => {
  const html = readFileSync('src/renderer/web.html', 'utf8')

  it('the meta tag matches the header and allows Discord avatars', () => {
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)
    expect(meta?.[1]).toBe(WEB_CSP)
    expect(WEB_CSP).toContain('https://cdn.discordapp.com')
  })

  it('links the shared favicon, which img-src \'self\' allows', () => {
    expect(html).toContain('<link rel="icon" href="/favicon.ico"')
    expect(html).toContain('<link rel="icon" href="/favicon.svg"')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"')
  })

  it('declares language and viewport', () => {
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />')
  })
})

describe('signed-out home favicon', () => {
  it('links the icons on the app host itself', async () => {
    const { renderHome } = await import('../../workers/portal/src/home')
    const page = renderHome({ siteUrl: 'https://duelbinder.com', name: null, signInFailed: false })
    expect(page).toContain('<link rel="icon" href="/favicon.ico"')
    expect(page).toContain('<link rel="icon" href="/favicon.svg"')
    expect(page).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">')
  })
})
