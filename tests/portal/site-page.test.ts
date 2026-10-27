import { describe, expect, it } from 'vitest'
import { detectOs } from '../../workers/portal/src/site/os'
import { formatSize, renderPage } from '../../workers/portal/src/site/page'
import { renderPrivacy } from '../../workers/portal/src/site/privacy'
import { pickDownloads, RELEASES_FALLBACK } from '../../workers/portal/src/site/releases'
import { releaseV021 } from './fixtures/release'

const downloads = pickDownloads(releaseV021)
const appUrl = 'https://app.duelbinder.com'
const page = (over: Partial<Parameters<typeof renderPage>[0]> = {}) =>
  renderPage({ downloads, os: null, appUrl, ...over })

describe('detectOs', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'mac'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0', 'linux'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', null],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', null],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', null],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', null],
    ['', null],
    [null, null],
  ])('%s -> %s', (ua, os) => {
    expect(detectOs(ua)).toBe(os)
  })
})

describe('formatSize', () => {
  it('uses decimal megabytes', () => {
    expect(formatSize(137045557)).toBe('137 MB')
    expect(formatSize(252235523)).toBe('252 MB')
  })
})

describe('renderPage', () => {
  it('has the charset, headline and lead', () => {
    const html = page()
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('A binder for your <span class="nowrap">Yu-Gi-Oh!</span> collection.')
    expect(html).toContain(
      "Log what you own by set, rarity and condition. Prices update on their own. It runs on your computer and works offline. Sign in with Discord to see your friends' binders on the web.",
    )
  })

  it('labels the hero button by OS', () => {
    const win = downloads.windows!.url
    expect(page({ os: 'windows' })).toContain(`<a class="btn pri" href="${win}">Download for Windows</a>`)
    expect(page({ os: 'mac' })).toContain(`href="${downloads.mac!.url}">Download for macOS</a>`)
    expect(page({ os: 'linux' })).toContain(`href="${downloads.linux!.url}">Download for Linux</a>`)
    expect(page({ os: null })).toContain('<a class="btn pri" href="#download">Download</a>')
  })

  it('falls back to the releases page for a missing asset', () => {
    const html = page({ os: 'mac', downloads: { ...downloads, mac: null } })
    expect(html).toContain(`<a class="btn pri" href="${RELEASES_FALLBACK}">Download for macOS</a>`)
  })

  it('shows the meta line with or without a version', () => {
    expect(page()).toContain('v0.2.1 · Windows, macOS, Linux · free')
    const none = page({ downloads: { ...downloads, version: null } })
    expect(none).toContain('Windows, macOS, Linux · free')
    expect(none).not.toMatch(/v\d[^<]* · Windows/)
    expect(none).not.toContain('v · Windows')
  })

  it('renders the download table', () => {
    const html = page()
    expect(html).toContain('id="download"')
    expect(html).toContain('yugioh-collection-tracker-0.2.1-setup.exe')
    expect(html).toContain('137 MB')
    const missing = page({ downloads: { ...downloads, linux: null } })
    const linuxRow = missing.split('<tr>').find((r) => r.startsWith('<td class="plat">Linux'))!
    expect(linuxRow).toContain(`href="${RELEASES_FALLBACK}"`)
    expect(linuxRow).not.toMatch(/\d+ MB/)
  })

  it('links sign-in, web app, GitHub and the footer', () => {
    const html = page()
    expect(html).toMatch(new RegExp(`href="${appUrl}"[^>]*>Sign in</a>`))
    expect(html).toMatch(new RegExp(`href="${appUrl}"[^>]*>Open the web app</a>`))
    expect(html).toContain('href="https://github.com/darkharasho/duel-binder"')
    expect(html).toContain('Duel Binder is not affiliated with Konami. Card data and images from YGOPRODeck.')
  })

  it('has the feature rows, with Friends as text only', () => {
    const html = page()
    for (const h of ["What it's worth", 'Finish your sets', 'Friends']) expect(html).toContain(h)
    expect(html.replace(/&#39;/g, "'")).toContain("What it's worth")
    const friends = html.slice(html.indexOf('<h2>Friends</h2>'))
    const row = friends.slice(0, friends.indexOf('</section>'))
    expect(row).not.toContain('<img')
  })

  it('has no script and escapes interpolated values', () => {
    const evil = { name: 'a<b"&.exe', size: 5_000_000, url: 'https://x.test/a<b"&.exe' }
    const html = page({ downloads: { ...downloads, windows: evil } })
    expect(html).not.toContain('<script')
    expect(html).not.toContain('a<b"&.exe')
    expect(html).toContain('a&lt;b&quot;&amp;.exe')
  })

  it('has the head metadata and well-formed images', () => {
    const html = page()
    expect(html).toContain('<title>Duel Binder — a binder for your Yu-Gi-Oh! collection</title>')
    expect(html).toContain('<meta property="og:image" content="https://duelbinder.com/og.png">')
    expect(html).toContain('<meta property="og:url" content="https://duelbinder.com/">')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    const imgs = html.match(/<img [^>]*>/g)!
    expect(imgs).toHaveLength(3)
    for (const img of imgs) {
      expect(img).toContain('width="2560" height="1600"')
      expect(img).toMatch(/alt="[^"]+"/)
    }
    expect(imgs[0]).toContain('/shots/collection.webp')
    expect(imgs[0]).not.toContain('loading="lazy"')
    for (const img of imgs.slice(1)) expect(img).toContain('loading="lazy"')
  })
})

describe('renderPrivacy', () => {
  it('privacy page renders and links home', () => {
    const html = renderPrivacy({ appUrl })
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<link rel="stylesheet" href="/site.css">')
    expect(html).toContain('<a class="brand" href="/">')
    expect(html).toContain('<h1>Privacy</h1>')
    for (const text of [
      'Discord id, username, display name and avatar',
      'your collection, notes and value history',
      'friends and blocks',
      'sign-in sessions',
      'to sync and show your binder',
      'Nothing is sold or used for ads.',
      'There are no third-party trackers.',
      'Card images are fetched through the portal',
      'Settings → Delete account',
      'https://github.com/darkharasho/duel-binder/issues'
    ]) {
      expect(html).toContain(text)
    }
    expect(html).toContain('<link rel="canonical" href="https://duelbinder.com/privacy">')
    expect(html).not.toMatch(/<script/i)
  })
})
