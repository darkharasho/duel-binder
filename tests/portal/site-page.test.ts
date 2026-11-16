import { describe, expect, it } from 'vitest'
import { detectOs, isAndroid } from '../../workers/portal/src/site/os'
import { formatSize, renderPage } from '../../workers/portal/src/site/page'
import { renderPrivacy } from '../../workers/portal/src/site/privacy'
import { MAGIC_FAN_CONTENT, SCRYFALL_CREDIT } from '../../src/shared/legal'
import { MAGIC_LANGUAGE_COUNT } from '../../src/shared/games/magic'
import { renderTerms } from '../../workers/portal/src/site/terms'
import { pickDownloads, RELEASES_FALLBACK } from '../../workers/portal/src/site/releases'
import { releaseV021 } from './fixtures/release'
import { pickWash } from '../../workers/portal/src/site/wash'
import { WASHES } from '../../workers/portal/src/site/washes'

const downloads = pickDownloads(releaseV021)
const appUrl = 'https://app.duelbinder.com'
const page = (over: Partial<Parameters<typeof renderPage>[0]> = {}): string =>
  renderPage({ downloads, os: null, android: false, appUrl, wash: WASHES[0], ...over })

describe('brand mark', () => {
  it('shows the D binder mark in the nav, standing in for the name', () => {
    expect(page()).toContain(
      '<a class="brand" href="/"><img class="mark" src="/mark.svg" width="30" height="34" alt="Duel Binder"></a>'
    )
  })

  it('puts the D on the closed binder cover, hidden from screen readers', () => {
    expect(page()).toContain(
      '<div class="face front"><div class="emblem"><svg viewBox="0 0 60 40" aria-hidden="true">'
    )
  })

  it('puts the D mark on the privacy and terms pages too', () => {
    for (const html of [renderPrivacy({ appUrl }), renderTerms({ appUrl })])
      expect(html).toContain('<a class="brand" href="/"><img class="mark" src="/mark.svg"')
  })
})

describe('colour wash', () => {
  it('paints the chosen card wash behind the page, with its base on <html> and the browser bar', () => {
    const w = WASHES[3]
    const html = page({ wash: w })
    expect(html).toContain(`<html lang="en" style="background:${w.base}">`)
    expect(html).toContain(`<meta name="theme-color" content="${w.base}">`)
    expect(html).toContain(
      `<div class="wash" aria-hidden="true" data-card="${w.card}" style="background:${w.pools}"></div>`
    )
  })

  it('picks a random wash per page load, covering the whole list', () => {
    expect(pickWash(() => 0)).toBe(WASHES[0])
    expect(pickWash(() => 0.999999)).toBe(WASHES[WASHES.length - 1])
    expect(page({ wash: undefined })).toMatch(
      /<div class="wash" aria-hidden="true" data-card="[^"]+" style="background:radial-gradient/
    )
  })

  it('has washes from all four games, each with pools and a base colour', () => {
    expect(WASHES.length).toBeGreaterThanOrEqual(8)
    for (const w of WASHES) {
      expect(w.base).toMatch(/^rgb\(\d+ \d+ \d+ \/ 1\)$/)
      expect(w.pools).toMatch(/^radial-gradient\(/)
      expect(w.pools).not.toMatch(/["<>]/)
    }
    for (const card of ['Dark Magician', 'Charizard ex', 'Lightning Bolt', 'Monkey.D.Luffy'])
      expect(WASHES.map((w) => w.card)).toContain(card)
  })
})

describe('detectOs', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'windows'
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      'mac'
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0', 'linux'],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
      null
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
      null
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
      null
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      null
    ],
    ['', null],
    [null, null]
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
    expect(html).toContain('<h1>Every card you own, in one digital binder.</h1>')
    expect(html).toContain(
      'Scan your <span class="nowrap">Yu-Gi-Oh!</span>, Pokémon, Magic and One Piece cards with a camera, or add them by hand.'
    )
  })

  it('labels the hero button by OS', () => {
    const win = downloads.windows!.url
    expect(page({ os: 'windows' })).toContain(
      `<a class="btn pri" href="${win}">Download for Windows</a>`
    )
    expect(page({ os: 'mac' })).toContain(`href="${downloads.mac!.url}">Download for macOS</a>`)
    expect(page({ os: 'linux' })).toContain(`href="${downloads.linux!.url}">Download for Linux</a>`)
    expect(page({ os: null })).toContain('<a class="btn pri" href="#download">Download</a>')
  })

  it('falls back to the releases page for a missing asset', () => {
    const html = page({ os: 'mac', downloads: { ...downloads, mac: null } })
    expect(html).toContain(`<a class="btn pri" href="${RELEASES_FALLBACK}">Download for macOS</a>`)
  })

  it('shows the meta line with or without a version', () => {
    expect(page()).toContain(
      '<p class="meta">Free for Windows, macOS and Linux. Version 0.2.1.</p>'
    )
    const none = page({ downloads: { ...downloads, version: null } })
    expect(none).toContain('<p class="meta">Free for Windows, macOS and Linux.</p>')
    expect(none).not.toContain('Version')
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
    expect(html).toContain('<script src="/account.js" defer></script>')
    expect(html).toMatch(new RegExp(`href="${appUrl}"[^>]*>Open the web app</a>`))
    expect(html).toContain('href="https://github.com/darkharasho/duel-binder"')
    expect(html).toContain(
      'Duel Binder is not affiliated with Konami, The Pokémon Company, Wizards of the Coast or Bandai. Card data and images from YGOPRODeck, Yugipedia, TCGdex, Scryfall and Bandai; prices from TCGplayer and eBay.'
    )
    expect(html).toContain('<a href="/privacy">Privacy</a>')
    expect(html).toContain('<a href="/terms">Terms</a>')
  })

  it('has the four games, the scanner and the feature rows', () => {
    const html = page()
    for (const g of ['Yu-Gi-Oh!', 'Pokémon', 'Magic: The Gathering', 'One Piece'])
      expect(html).toContain(`<h3>${g}</h3>`)
    expect(html).toContain('id="games"')
    expect(html).toContain('id="scan"')
    expect(html).toContain('<h2>Hold a card up to the camera</h2>')
    for (const mode of ['Card', 'Code', 'Stream'])
      expect(html).toMatch(
        new RegExp(
          `<button type="button" aria-pressed="(true|false)" data-mode="${mode.toLowerCase()}" data-note="${mode} [^"]+">${mode}</button>`
        )
      )
    for (const h of ["What it's worth", 'Finish your sets', 'Also in the app'])
      expect(html).toContain(h)
  })

  it('lists the smaller features as text only', () => {
    const html = page()
    const more = html.slice(html.indexOf('<section class="more rise">'))
    const block = more.slice(0, more.indexOf('</section>'))
    for (const h of [
      'Binders',
      'Wishlist',
      'Pokédex',
      'Friends',
      'Many languages',
      'Offline first'
    ])
      expect(block).toContain(`<h3>${h}</h3>`)
    expect(block).not.toContain('<img')
  })

  it('names desktop, phone and web, and the web app address', () => {
    const html = page()
    expect(html).toContain('<h2>On your computer, your phone and the web</h2>')
    expect(html).toContain(`<a href="${appUrl}">app.duelbinder.com</a>`)
    expect(html).not.toMatch(/apps\.apple\.com|play\.google\.com/)
  })

  it('has only its own scripts and escapes interpolated values', () => {
    const evil = { name: 'a<b"&.exe', size: 5_000_000, url: 'https://x.test/a<b"&.exe' }
    const html = page({ downloads: { ...downloads, windows: evil } })
    expect(html.match(/<script[^>]*>/g)).toEqual([
      '<script>',
      '<script src="/account.js" defer>',
      '<script src="/home.js" defer>',
      '<script type="application/json" id="washes">'
    ])
    expect(html).toContain("<script>document.documentElement.classList.add('js')</script>")
    expect(html).not.toContain('a<b"&.exe')
    expect(html).toContain('a&lt;b&quot;&amp;.exe')
  })

  it('has the head metadata and well-formed images', () => {
    const html = page()
    expect(html).toContain('<title>Duel Binder — a binder for your trading cards</title>')
    expect(html).toContain('<meta property="og:image" content="https://duelbinder.com/og.png">')
    expect(html).toContain('<meta property="og:url" content="https://duelbinder.com/">')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    const imgs = html.match(/<img [^>]*>/g)!.filter((img) => img.includes('/shots/'))
    expect(imgs).toHaveLength(1)
    expect(imgs[0]).toContain('/shots/dashboard.webp')
    expect(imgs[0]).toContain('width="2560" height="1600"')
    expect(imgs[0]).toMatch(/alt="[^"]+"/)
    expect(html).toContain(
      '<link rel="stylesheet" href="/site.css">\n<link rel="stylesheet" href="/home.css">'
    )
  })

  it('opens a binder of two 9-pocket spreads, each card labelled for the hover tag', () => {
    const html = page()
    const pockets = html.match(
      /<div class="pocket" data-name="[^"]+" data-code="[^"]+" data-price="[^"]+">/g
    )!
    expect(pockets).toHaveLength(36)
    expect(html).toContain('data-name="Maxx &quot;C&quot;"')
    expect(html).toContain('data-name="Ash Blossom &amp; Joyous Spring"')
    // without script the binder lies open: home.css closes it only under html.js
    expect(html).toContain('<div class="binder" id="binder"')
  })

  it('loads every card picture from the app host, lazily', () => {
    const html = page({ appUrl: 'https://app.example.test/' })
    const cards = html.match(/<img [^>]*\/img\/small\/[^>]*>/g)!
    expect(cards.length).toBeGreaterThan(60)
    for (const img of cards) {
      expect(img).toMatch(/src="https:\/\/app\.example\.test\/img\/small\/\d+"/)
      if (!img.includes('class="new"')) expect(img).toContain('loading="lazy"')
    }
  })

  it('gives /home.js every wash by card, and the hero the one picked for this visit', () => {
    const w = WASHES[5]
    const html = page({ wash: w })
    const json = html.match(/<script type="application\/json" id="washes">(.*?)<\/script>/)![1]
    const map = JSON.parse(json) as Record<string, { base: string; pools: string }>
    for (const x of WASHES) expect(map[x.card]).toEqual({ base: x.base, pools: x.pools })
    expect(html).toContain(
      `<div class="run" id="run" data-wash="${w.card}" data-turned="Black Luster Soldier">`
    )
    // every section's wash exists
    for (const [, card] of html.matchAll(/data-wash="([^"]+)"/g)) expect(map[card]).toBeDefined()
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
      'your collection, wishlist, notes, binders, favourites, scan sessions and value history',
      'friends and blocks',
      'sign-in sessions',
      'to sync and show your collection',
      'Nothing is sold or used for ads.',
      'There are no third-party trackers.',
      'the camera picture is processed on your device and never uploaded',
      'Card images come through the portal',
      'Discord avatars, yours and your friends’, come straight from Discord',
      'the desktop app checks GitHub for updates',
      'Settings → Delete account',
      'https://github.com/darkharasho/duel-binder/issues',
      'The portal also asks Discord and Apple for your email',
      'when your account last used the portal, to the hour',
      'Anonymous usage counts',
      'You can turn them off in Settings',
      'The portal runs on Cloudflare',
      'Last updated',
      '<a href="mailto:support@duelbinder.com">support@duelbinder.com</a>',
      // Email sign-in, scanner photos and beta requests (2026-11-16).
      'only as a salted hash',
      'Scanner photos you send',
      'Beta requests',
      'App Store Connect',
      'Google Groups'
    ]) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('an account needs Discord or Apple')
    expect(html).toContain('<link rel="canonical" href="https://duelbinder.com/privacy">')
    expect(html.replace('<script src="/account.js" defer></script>', '')).not.toMatch(/<script/i)
  })
})

describe('marketing home page and Magic', () => {
  it('carries the Wizards Fan Content notice and credits Scryfall, now that Magic is open to everyone', () => {
    const html = page()
    expect(html).toContain(MAGIC_FAN_CONTENT)
    expect(html).toContain('Scryfall')
    expect(html).toContain('Magic: The Gathering')
  })
})

describe('renderTerms', () => {
  it('carries the Wizards Fan Content notice and the Scryfall credit', () => {
    const html = renderTerms({ appUrl })
    expect(html).toContain(MAGIC_FAN_CONTENT)
    expect(html).toContain(SCRYFALL_CREDIT)
    expect(html).toContain('©Wizards of the Coast LLC.')
  })

  it('terms page renders, links the privacy policy and has the footer links', () => {
    const html = renderTerms({ appUrl })
    expect(html).toContain('<h1>Terms of Service</h1>')
    expect(html).toContain('<link rel="canonical" href="https://duelbinder.com/terms">')
    for (const text of [
      '<a href="/privacy">privacy policy</a>',
      'not affiliated with or endorsed by Konami',
      'Settings → Delete account',
      'provided “as is”',
      'Acceptable use',
      'https://github.com/darkharasho/duel-binder/issues',
      '<a href="/terms">Terms</a>',
      'mailto:support@duelbinder.com'
    ])
      expect(html).toContain(text)
    expect(html.replace('<script src="/account.js" defer></script>', '')).not.toMatch(/<script/i)
  })
})

describe('Android', () => {
  const PIXEL =
    'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
  const apk = {
    name: 'Duel-Binder-0.48.0.apk',
    size: 25_000_000,
    url: 'https://x.test/Duel-Binder-0.48.0.apk'
  }
  const withApk = { ...downloads, android: apk }

  it('knows an Android phone', () => {
    expect(isAndroid(PIXEL)).toBe(true)
    expect(isAndroid('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(false)
    expect(isAndroid('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false)
    expect(isAndroid(null)).toBe(false)
  })

  it('offers an Android phone the APK once a release has one', () => {
    const html = page({ android: true, downloads: withApk })
    expect(html).toContain(`<a class="btn pri" href="${apk.url}">Download for Android</a>`)
    expect(html).toContain(
      '<p class="meta">Free for Android. Allow installs from your browser when Android asks.</p>'
    )
    expect(html).toContain('Allow installs from your browser when Android asks.')
  })

  it('leaves the hero as it is for Android without an APK', () => {
    expect(page({ android: true })).toBe(page())
  })

  it('points the phone column at the APK only when the release has one', () => {
    expect(page()).not.toContain('The Android app is in the download list below.')
    expect(page({ downloads: withApk })).toContain('The Android app is in the download list below.')
  })

  it('sends iPhone users to the home-screen scanner', () => {
    expect(page()).toMatch(/On iPhone, open <a href="[^"]+\/scan\/">[^<]+\/scan\/<\/a> in Safari/)
  })

  it('counts Magic languages from the game itself', () => {
    expect(page()).toContain(`in ${MAGIC_LANGUAGE_COUNT} languages`)
  })

  it('lists Android in the download table only when the APK exists', () => {
    const row = (html: string): string | undefined =>
      html.split('<tr>').find((r) => r.startsWith('<td class="plat">Android'))
    expect(row(page())).toBeUndefined()
    const android = row(page({ downloads: withApk }))!
    expect(android).toContain('Duel-Binder-0.48.0.apk · 25 MB')
    expect(android).toContain(`href="${apk.url}"`)
  })

  it('leaves desktop visitors as they were', () => {
    expect(page({ os: 'windows', downloads: withApk })).toContain('Download for Windows</a>')
  })
})
