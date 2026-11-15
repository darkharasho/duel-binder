import { MAGIC_FAN_CONTENT } from '../../../../src/shared/legal'
import { MAGIC_LANGUAGE_COUNT } from '../../../../src/shared/games/magic'
import { RELEASES_FALLBACK, type Asset, type Downloads } from './releases'
import type { Os } from './os'

export interface PageView {
  downloads: Downloads
  os: Os | null
  /** An Android visitor, offered the APK when the latest release has one. */
  android: boolean
  appUrl: string
}

export const REPO_URL = 'https://github.com/darkharasho/duel-binder'
const TITLE = 'Duel Binder — a binder for your trading cards'
const DESCRIPTION =
  'Duel Binder catalogs your Yu-Gi-Oh!, Pokémon, Magic: The Gathering and One Piece cards. Scan them with a camera, follow their prices and finish your sets, on your computer, your phone and the web.'
const LEAD =
  'Scan your <span class="nowrap">Yu-Gi-Oh!</span>, Pokémon, Magic and One Piece cards with a camera, or add them by hand. Duel Binder finds the exact printing, keeps prices up to date and shows what each set still needs. It runs on your computer and your phone, and works offline.'

// The favicon, drawn for small sizes (resources/brand/small.svg); so there is only one mark to keep.
export const MARK = `<img src="/favicon.svg" width="28" height="28" alt="">`

const OS_LABEL: Record<Os, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' }

export const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Decimal megabytes, rounded. */
export function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`
}

function nav(appUrl: string): string {
  return `<nav><div class="wrap navin">
<a class="brand" href="/">${MARK}Duel Binder</a>
<a class="sec" href="#scan">Scanner</a><a class="sec" href="#features">Features</a><a href="#download">Download</a><a class="sec" href="${REPO_URL}">GitHub</a>
<span class="grow"></span><a class="signin" href="${esc(appUrl)}">Sign in</a>
</div></nav>`
}

const ANDROID_NOTE = 'Allow installs from your browser when Android asks.'

function shot(src: string, alt: string, lazy = true): string {
  return `<figure class="frame shot"><img src="${src}" width="2560" height="1600" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''}></figure>`
}

function hero(v: PageView): string {
  const { downloads, os, appUrl } = v
  const apk = v.android ? downloads.android : null
  const asset = os ? downloads[os] : null
  const label = apk ? 'Download for Android' : os ? `Download for ${OS_LABEL[os]}` : 'Download'
  const href = apk ? apk.url : os ? (asset ? asset.url : RELEASES_FALLBACK) : '#download'
  const platforms = apk ? `Android · free · ${ANDROID_NOTE}` : 'Windows, macOS, Linux · free'
  const meta = `${downloads.version ? `v${downloads.version} · ` : ''}${platforms}`
  return `<header class="hero">
<h1>A binder for every card you own.</h1>
<p class="lead">${LEAD}</p>
<div class="actions"><a class="btn pri" href="${esc(href)}">${label}</a><a class="btn out" href="${esc(appUrl)}">Open the web app</a></div>
<div class="meta mono">${esc(meta)}</div>
</header>
${shot('/shots/collection.webp', 'The Collection page of the Duel Binder desktop app: Yu-Gi-Oh! cards sorted by total price, over a soft wash of colour from the card art.', false)}`
}

const GAMES: { id: string; name: string; body: string }[] = [
  {
    id: 'ygo',
    name: 'Yu-Gi-Oh!',
    body: 'TCG and OCG printings, in English, Japanese, Korean, Chinese and the European languages.'
  },
  {
    id: 'pkm',
    name: 'Pokémon',
    body: 'English, Japanese, Chinese and European sets, plus a Pokédex to fill.'
  },
  {
    id: 'mtg',
    name: 'Magic: The Gathering',
    body: `Sets from Scryfall in ${MAGIC_LANGUAGE_COUNT} languages, back faces included. Mark foils as you scan.`
  },
  {
    id: 'op',
    name: 'One Piece',
    body: 'English and Japanese cards, alternate arts and DON!! cards included.'
  }
]

function games(): string {
  const tiles = GAMES.map(
    (g) =>
      `<li class="game g-${g.id}"><div class="sw" aria-hidden="true"></div><h3>${g.name}</h3><p>${g.body}</p></li>`
  ).join('')
  return `<section class="games" id="games"><div class="head"><h2>Four games in one app</h2><p>Each game keeps its own collection, sets and prices. Switch between them from the sidebar.</p></div>
<ul class="tiles">${tiles}</ul>
${shot('/shots/collection-pokemon.webp', 'The Collection page showing Pokémon cards sorted by total price, from Umbreon VMAX down.')}
</section>`
}

function feature(
  id: string,
  heading: string,
  body: string,
  img?: { src: string; alt: string }
): string {
  return `<section class="f"${id ? ` id="${id}"` : ''}><div class="ft"><h2>${heading}</h2>${body}</div>${img ? shot(img.src, img.alt) : ''}</section>`
}

const MODES: [string, string][] = [
  ['Card', 'reads the whole card, one after another'],
  ['Code', 'reads only the set code printed on the card'],
  ['Stream', 'a full-screen camera view for streaming your pulls']
]

function scanner(): string {
  const modes = MODES.map(([m, d]) => `<li><b>${m}</b> ${d}</li>`).join('')
  return feature(
    'scan',
    'Hold a card up to the camera',
    `<p>Use a webcam or a capture card on your computer, or your phone's camera. Duel Binder reads the card, the printing and the rarity, then adds it to your collection.</p>
<p>The phone scanner has three modes:</p>
<ul class="modes">${modes}</ul>
<p>It spots Pokémon reverse holos. Every scanning session is kept: look back at what you pulled, and save the best cards as a short replay video or one image.</p>`,
    {
      src: '/shots/sessions.webp',
      alt: 'The Sessions page: two scanning sessions from today, each with its cards sorted by price and buttons to make a replay or save an image.'
    }
  )
}

function worth(): string {
  return feature(
    'features',
    "What it's worth",
    '<p>Total value, card counts and your most valuable pulls. Prices update on their own, and Japanese, Korean and Chinese printings get prices from eBay listings.</p><p>The value chart is the same on every device you sign in on.</p>',
    {
      src: '/shots/dashboard.webp',
      alt: 'The Dashboard page: the total value of a Yu-Gi-Oh! collection over three months, its most valuable cards, and breakdowns by rarity and card type.'
    }
  )
}

function sets(): string {
  return feature(
    '',
    'Finish your sets',
    '<p>Every set and printing in the catalog, with a checklist of what you still need. Print placeholders for the empty slots in your real binder.</p>',
    {
      src: '/shots/sets.webp',
      alt: 'The Pokémon Base Set page with 72 of 102 cards owned; the cards still missing are greyed out.'
    }
  )
}

const MORE: [string, string][] = [
  [
    'Binders',
    'Lay cards out on binder pages and turn them like the real thing. Rules can fill a binder for you.'
  ],
  ['Wishlist', "Keep a list of the cards you're after."],
  ['Pokédex', 'See which Pokémon you have a card of, generation by generation.'],
  [
    'Friends',
    "Sign in with Discord or email, add friends, and look through each other's collections and binders on the web."
  ],
  [
    'Many languages',
    'Printings in Japanese, Korean, Chinese, French, German, Italian, Spanish and Portuguese, not only English.'
  ],
  [
    'Offline first',
    'Your collection is kept on your device and works without a connection. Signing in adds sync.'
  ]
]

function more(): string {
  const items = MORE.map(([h, p]) => `<div><h3>${h}</h3><p>${esc(p)}</p></div>`).join('')
  return `<section class="more"><h2>Also in the app</h2><div class="grid">${items}</div></section>`
}

function devices(v: PageView): string {
  const android = v.downloads.android
    ? 'The Android app is in the download list below.'
    : 'The Android app is on its way to the download list.'
  const app = esc(v.appUrl)
  const scan = `${v.appUrl.replace(/\/$/, '')}/scan/`
  return `<section class="devices" id="devices"><h2>On your computer, your phone and the web</h2><div class="cols">
<div><h3>Desktop</h3><p>Windows, macOS and Linux. Scan with a webcam or a capture card. The app updates itself.</p></div>
<div><h3>Phone</h3><p>Scan with your phone's camera and carry your collection with you. ${android} On iPhone, open <a href="${esc(scan)}">${esc(scan.replace(/^https?:\/\//, ''))}</a> in Safari and add it to your home screen.</p></div>
<div><h3>Web</h3><p>Open your collection, binders and friends in any browser at <a href="${app}">${esc(v.appUrl.replace(/^https?:\/\//, ''))}</a>.</p></div>
</div><p class="sync">Sign in once and your collection, binders, wishlist and value history stay in sync on all three.</p></section>`
}

function downloadRow(name: string, asset: Asset | null, note = ''): string {
  const file = asset ? `${esc(asset.name)} · ${formatSize(asset.size)}` : ''
  return `<tr><td class="plat">${name}</td><td class="m mono">${file}${note}</td><td class="act"><a class="btn out sm" href="${esc(asset ? asset.url : RELEASES_FALLBACK)}">Download</a></td></tr>`
}

function downloadTable(d: Downloads): string {
  return `<section class="f" id="download"><div class="ft"><h2>Download</h2><p>Free. The app checks for updates itself.</p></div>
<table>
${downloadRow('Windows', d.windows)}
${downloadRow('macOS', d.mac, d.mac ? ' · Apple silicon &amp; Intel' : '')}
${downloadRow('Linux', d.linux)}
${d.android ? downloadRow('Android', d.android, ` · ${ANDROID_NOTE}`) : ''}
</table></section>`
}

export function footer(): string {
  return `<footer><div class="legal"><p>Duel Binder is not affiliated with Konami, The Pokémon Company, Wizards of the Coast or Bandai. Card data and images from YGOPRODeck, Yugipedia, TCGdex, Scryfall and Bandai; prices from TCGplayer and eBay.</p><p>${MAGIC_FAN_CONTENT}</p></div><span class="links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="${REPO_URL}">GitHub</a></span></footer>`
}

export function renderPage(view: PageView): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:image" content="https://duelbinder.com/og.png">
<meta property="og:url" content="https://duelbinder.com/">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="/fonts/bricolage-grotesque-latin-wdth-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css">
<script src="/account.js" defer></script>
</head>
<body class="home">
<div class="wash" aria-hidden="true"><div></div></div>
${nav(view.appUrl)}
<main class="wrap">
${hero(view)}
${games()}
${scanner()}
${worth()}
${sets()}
${more()}
${devices(view)}
${downloadTable(view.downloads)}
</main>
<div class="wrap">${footer()}</div>
</body>
</html>
`
}
