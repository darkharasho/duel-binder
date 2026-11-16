import { MAGIC_FAN_CONTENT } from '../../../../src/shared/legal'
import { MAGIC_LANGUAGE_COUNT } from '../../../../src/shared/games/magic'
import { RELEASES_FALLBACK, type Asset, type Downloads } from './releases'
import type { Os } from './os'
import { pickWash, washLayer, washRootStyle, type Wash } from './wash'
import { WASHES } from './washes'
import {
  BINDER,
  DEVICE_CARDS,
  DEVICE_TOTAL,
  FANS,
  SCAN_CARD,
  SET_CARDS,
  SET_MISSING,
  SYNC_CARD,
  TURNED_WASH,
  WEB_BINDER,
  type ShowCard
} from './showcase'

export interface PageView {
  downloads: Downloads
  os: Os | null
  /** An Android visitor, offered the APK when the latest release has one. */
  android: boolean
  appUrl: string
  /** The colour wash behind the page; a random one when left out. */
  wash?: Wash
}

export const REPO_URL = 'https://github.com/darkharasho/duel-binder'
const TITLE = 'Duel Binder — a binder for your trading cards'
const DESCRIPTION =
  'Duel Binder catalogs your Yu-Gi-Oh!, Pokémon, Magic: The Gathering and One Piece cards. Scan them with a camera, follow their prices and finish your sets, on your computer, your phone and the web.'
const LEAD =
  'Scan your <span class="nowrap">Yu-Gi-Oh!</span>, Pokémon, Magic and One Piece cards with a camera, or add them by hand. Duel Binder finds the exact printing, keeps prices up to date and shows what each set still needs.'

// The D binder mark, as in the app's sidebar (src/renderer/src/assets/logo-mark.svg). It stands in
// for the name, so its alt text is the name.
export const MARK = `<img class="mark" src="/mark.svg" width="30" height="34" alt="Duel Binder">`

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
<a class="brand" href="/">${MARK}</a>
<a class="sec" href="#games">Games</a><a class="sec" href="#scan">Scanner</a><a class="sec" href="#features">Features</a><a href="#download">Download</a>
<span class="grow"></span><a class="sec" href="${REPO_URL}">GitHub</a><a class="signin" href="${esc(appUrl)}">Sign in</a>
</div></nav>`
}

const ANDROID_NOTE = 'Allow installs from your browser when Android asks.'

/** A card image from the portal: the small copy, which every game has. */
const cardSrc = (appUrl: string, id: string): string =>
  `${esc(appUrl.replace(/\/$/, ''))}/img/small/${esc(id)}`
const cardImg = (appUrl: string, id: string, alt = ''): string =>
  `<img src="${cardSrc(appUrl, id)}" alt="${esc(alt)}" loading="lazy" decoding="async">`

function shot(src: string, alt: string): string {
  return `<figure class="shot"><img src="${src}" width="2560" height="1600" alt="${esc(alt)}" loading="lazy"></figure>`
}

// ---------- Hero: the binder ----------

/** A page of nine sleeves; each card's name, set code and price are read by the hover label. */
function binderPage(appUrl: string, cls: string, cards: ShowCard[]): string {
  const pockets = cards
    .map(
      (c, i) =>
        `<div class="pocket" data-name="${esc(c.name)}" data-code="${esc(c.code)}" data-price="${esc(c.price)}"><div class="card" style="--r:${(((i * 37) % 5) - 2) * 0.35}deg">${cardImg(appUrl, c.id, c.name)}</div></div>`
    )
    .join('')
  return `<div class="pgpage ${cls}"><div class="glare"></div>${pockets}</div>`
}

const EMBLEM = `<div class="emblem"><svg viewBox="0 0 60 40" aria-hidden="true"><g fill="none" stroke="#fff4e8" stroke-width="4" stroke-linejoin="round"><path d="M22 4 38 20 22 36 6 20Z"/><path d="M38 4 54 20 38 36 22 20Z"/></g></svg></div>`

/**
 * An open card binder. Without script it simply lies open (home.css closes it only under .js); /home.js swings the cover
 * open on load and drives the scroll sequence (lift, zoom, page turn).
 */
function binder(appUrl: string): string {
  return `<div class="binder" id="binder" role="img" aria-label="An open card binder holding Yu-Gi-Oh!, Pokémon, Magic and One Piece cards">
<div class="stage"><div class="slide"><div class="tilt" id="tilt">
<div class="floor"></div><div class="shell"></div>
${binderPage(appUrl, 'right under', BINDER.right2)}
<div class="spine"></div>
<div class="leaf turn" id="turn"><div class="face flip" id="turnBack">${binderPage(appUrl, 'left', BINDER.left2)}</div><div class="face" id="turnFront">${binderPage(appUrl, 'right', BINDER.right)}</div></div>
<div class="rings"><i></i><i></i><i></i></div>
<div class="leaf cover"><div class="face flip">${binderPage(appUrl, 'left', BINDER.left)}</div><div class="face front">${EMBLEM}</div></div>
</div></div></div>
</div>`
}

function hero(v: PageView, wash: Wash): string {
  const { downloads, os, appUrl } = v
  const apk = v.android ? downloads.android : null
  const asset = os ? downloads[os] : null
  const label = apk ? 'Download for Android' : os ? `Download for ${OS_LABEL[os]}` : 'Download'
  const href = apk ? apk.url : os ? (asset ? asset.url : RELEASES_FALLBACK) : '#download'
  const version = downloads.version ? ` Version ${esc(downloads.version)}.` : ''
  const meta = apk
    ? `Free for Android. ${ANDROID_NOTE}`
    : `Free for Windows, macOS and Linux.${version}`
  return `<div class="run" id="run" data-wash="${esc(wash.card)}" data-turned="${esc(TURNED_WASH)}"><div class="pin" id="pin"><div class="wrap">
<header class="top" id="top"><h1>Every card you own, in one digital binder.</h1><div>
<p class="lead">${LEAD}</p>
<div class="actions"><a class="btn pri" href="${esc(href)}">${label}</a><a class="btn out" href="${esc(appUrl)}">Open the web app</a></div>
<p class="meta">${meta}</p>
</div></header>
${binder(appUrl)}
</div><div class="chip" id="chip" aria-hidden="true"></div><div class="cue" id="cue" aria-hidden="true">Scroll to turn the page</div></div></div>`
}

// ---------- Games ----------

const GAMES: { id: keyof typeof FANS; name: string; body: string }[] = [
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

function games(appUrl: string): string {
  const rows = GAMES.map((g) => {
    const fan = FANS[g.id]
    return `<div class="game g-${g.id}" data-wash="${esc(fan.wash)}"><div><h3>${g.name}</h3><p>${g.body}</p><p class="data mono">${esc(fan.codes)}</p></div><div class="fan" aria-hidden="true">${fan.ids.map((id) => cardImg(appUrl, id)).join('')}</div></div>`
  }).join('\n')
  return `<section class="games" id="games"><h2>Four games, each with its own binder</h2><p class="intro">Each game keeps its own collection, sets and prices. Switch between them from the sidebar.</p>
${rows}
</section>`
}

// ---------- Scanner ----------

const MODES: [string, string][] = [
  ['Card', 'reads the whole card, one after another.'],
  ['Code', 'reads only the set code printed on the card. Quick for a big pile from one set.'],
  [
    'Stream',
    'is a full-screen camera view for streaming your pulls, with each card shown on screen.'
  ]
]

function scanner(appUrl: string): string {
  const buttons = MODES.map(
    ([m, d], i) =>
      `<button type="button" aria-pressed="${i === 0}" data-mode="${m.toLowerCase()}" data-note="${esc(`${m} ${d}`)}">${m}</button>`
  ).join('')
  const c = SCAN_CARD
  return `<section id="scan" data-wash="Dark Magician"><div class="split rise">
<div class="copy" style="--i:0"><h2>Hold a card up to the camera</h2>
<p>Use a webcam or a capture card on your computer, or your phone's camera. Duel Binder reads the card, the printing and the rarity, then adds it to your collection.</p>
<p>It spots Pokémon reverse holos. Every scanning session is kept: look back at what you pulled, and save the best cards as a short replay video or one image.</p>
<div class="modes" role="group" aria-label="Scanner mode">${buttons}</div>
<p class="modenote" id="modenote" aria-live="polite">${esc(`${MODES[0][0]} ${MODES[0][1]}`)}</p></div>
<div class="phone" style="--i:2" aria-hidden="true"><div class="screen m-card" id="screen">
<div class="bar"><span>Yu-Gi-Oh!</span><span class="count"><b id="scount">12</b> cards this session</span></div>
<div class="scard">${cardImg(appUrl, c.id)}</div>
<div class="target"><i></i><i></i><i></i><i></i></div>
<div class="sheet">${cardImg(appUrl, c.id)}<div class="t"><b>${esc(c.name)}</b><span class="mono">${esc(c.code)}</span> ${esc(c.rarity)}</div><div class="p">${esc(c.price)}</div></div>
</div></div>
</div></section>`
}

function worth(): string {
  return `<section id="features" data-wash="Umbreon VMAX"><div class="copy rise">
<h2 style="--i:0">What it's worth</h2>
<p style="--i:1">Total value, card counts and your most valuable pulls. Prices update on their own, and Japanese, Korean and Chinese printings get prices from eBay listings. The value chart is the same on every device you sign in on.</p>
</div>
${shot('/shots/dashboard.webp', 'The Dashboard page: the total value of a Yu-Gi-Oh! collection over three months, its most valuable cards, and breakdowns by rarity and card type.')}
</section>`
}

function sets(appUrl: string): string {
  const missing = new Set(SET_MISSING)
  const slots = SET_CARDS.map((id, i) =>
    missing.has(i)
      ? `<button type="button" class="slot miss" aria-label="Mark as owned">${cardImg(appUrl, id)}</button>`
      : `<div class="slot">${cardImg(appUrl, id)}</div>`
  ).join('')
  const owned = SET_CARDS.length - missing.size
  return `<section data-wash="Black Luster Soldier"><div class="split rise">
<div class="setcard" style="--i:0"><div class="sethead"><b>Yu-Gi-Oh! classics</b><span class="n mono" id="setn">${owned} of ${SET_CARDS.length}</span></div>
<div class="progress"><i id="setbar" style="--p:${(owned / SET_CARDS.length).toFixed(3)}"></i></div>
<div class="slots" id="slots" data-total="${SET_CARDS.length}">${slots}</div>
<p class="hint">Tap a grey card to mark it as yours.</p></div>
<div class="copy" style="--i:2"><h2>Finish your sets</h2>
<p>Every set and printing in the catalog, with a checklist of what you still need. Print placeholders for the empty slots in your real binder.</p></div>
</div></section>`
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
  const items = MORE.map(
    ([h, p], i) => `<div style="--i:${i + 1}"><h3>${h}</h3><p>${esc(p)}</p></div>`
  ).join('')
  return `<section class="more rise"><h2>Also in the app</h2><div class="grid stag">${items}</div></section>`
}

// ---------- Devices ----------

const figure = (appUrl: string, c: ShowCard): string =>
  `<figure>${cardImg(appUrl, c.id)}<figcaption>${esc(c.name)}</figcaption></figure>`
const phoneRow = (appUrl: string, c: ShowCard): string =>
  `<div class="prow">${cardImg(appUrl, c.id)}<div><b>${esc(c.name)}</b><span class="mono">${esc(c.code)}</span></div><em>${esc(c.price)}</em></div>`

function devices(v: PageView): string {
  const { appUrl } = v
  const android = v.downloads.android
    ? 'The Android app is in the download list below.'
    : 'The Android app is on its way to the download list.'
  const scan = `${appUrl.replace(/\/$/, '')}/scan/`
  const webPage = (ids: string[]): string =>
    `<div>${ids.map((id) => (id === 'sync' ? `<img class="new" src="${cardSrc(appUrl, SYNC_CARD.id)}" alt="">` : id ? cardImg(appUrl, id) : '<i></i>')).join('')}</div>`
  return `<section class="devices rise" id="devices" data-wash="Lugia V"><h2>On your computer, your phone and the web</h2>
<div class="devs stag">
<div class="dev laptop" style="--i:1"><div class="scr" aria-hidden="true"><div class="app"><aside><img src="/mark.svg" alt=""><i class="on"></i><i></i><i></i><i></i><i></i></aside><div class="main"><div class="ah"><b>Collection</b><span class="mono total">${DEVICE_TOTAL.before}</span></div><div class="cgrid list">${DEVICE_CARDS.map((c) => figure(appUrl, c)).join('')}</div></div></div><span class="tick">Synced</span></div><div class="base"></div>
<h3>Desktop</h3><p>Windows, macOS and Linux. Scan with a webcam or a capture card. The app updates itself.</p></div>
<div class="dev mobile" style="--i:2"><div class="scr" aria-hidden="true"><div class="papp"><div class="ah"><b>Collection</b><span class="mono total">${DEVICE_TOTAL.before}</span></div><div class="list">${DEVICE_CARDS.slice(
    0,
    9
  )
    .map((c) => phoneRow(appUrl, c))
    .join('')}</div></div><span class="tick">Added</span></div>
<h3>Phone</h3><p>Scan with your phone's camera and carry your collection with you. ${android} On iPhone, open <a href="${esc(scan)}">${esc(scan.replace(/^https?:\/\//, ''))}</a> in Safari and add it to your home screen. Want the store app? <a href="/beta">Join the beta</a>.</p></div>
<div class="dev browser" style="--i:3"><div class="scr" aria-hidden="true"><div class="url"><span class="mono">${esc(appUrl.replace(/^https?:\/\//, ''))}/u/sam/binders/main</span></div><div class="wbody"><div class="ah"><b>Sam's main binder</b><span>page 3 of 12</span></div><div class="spread">${WEB_BINDER.map(webPage).join('')}</div></div><span class="tick">Synced</span></div>
<h3>Web</h3><p>Your collection, binders and friends in any browser at <a href="${esc(appUrl)}">${esc(appUrl.replace(/^https?:\/\//, ''))}</a>.</p></div>
</div>
<template id="sync-figure">${figure(appUrl, SYNC_CARD)}</template><template id="sync-row">${phoneRow(appUrl, SYNC_CARD)}</template>
<div class="syncbar"><button type="button" class="btn out" id="syncbtn" data-after="${DEVICE_TOTAL.after}" data-before="${DEVICE_TOTAL.before}">Add ${esc(SYNC_CARD.name)} on the phone</button><p>Sign in once and your collection, binders, wishlist and value history stay in sync on all three.</p></div>
</section>`
}

// ---------- Download ----------

function downloadRow(name: string, asset: Asset | null, note = ''): string {
  const file = asset ? `${esc(asset.name)} · ${formatSize(asset.size)}` : ''
  return `<tr><td class="plat">${name}</td><td class="m mono">${file}${note}</td><td class="act"><a class="btn out sm" href="${esc(asset ? asset.url : RELEASES_FALLBACK)}">Download</a></td></tr>`
}

function downloadTable(d: Downloads): string {
  return `<section id="download" class="rise" data-wash="Mew ex"><h2>Download</h2><p class="intro" style="--i:1">Free. The app checks for updates itself.</p>
<table style="--i:2">
${downloadRow('Windows', d.windows)}
${downloadRow('macOS', d.mac, d.mac ? ' · Apple silicon &amp; Intel' : '')}
${downloadRow('Linux', d.linux)}
${d.android ? downloadRow('Android', d.android, ` · ${ANDROID_NOTE}`) : ''}
</table></section>`
}

export function footer(): string {
  return `<footer><div class="legal"><p>Duel Binder is not affiliated with Konami, The Pokémon Company, Wizards of the Coast or Bandai. Card data and images from YGOPRODeck, Yugipedia, TCGdex, Scryfall and Bandai; prices from TCGplayer and eBay.</p><p>${MAGIC_FAN_CONTENT}</p></div><span class="links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="${REPO_URL}">GitHub</a></span></footer>`
}

/** Every wash by card name, for /home.js to cross-fade to as sections come into view. */
function washData(): string {
  const map = Object.fromEntries(WASHES.map((w) => [w.card, { base: w.base, pools: w.pools }]))
  return JSON.stringify(map).replace(/</g, '\\u003c')
}

export function renderPage(view: PageView): string {
  const wash = view.wash ?? pickWash()
  return `<!doctype html>
<html lang="en" style="${washRootStyle(wash)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${wash.base}">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="impact-site-verification" value="6be828db-04ec-4b49-a86f-5fd0da352918">
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
<link rel="stylesheet" href="/home.css">
<script>document.documentElement.classList.add('js')</script>
<script src="/account.js" defer></script>
<script src="/home.js" defer></script>
</head>
<body class="home">
${washLayer(wash)}
${nav(view.appUrl)}
${hero(view, wash)}
<main class="wrap">
${games(view.appUrl)}
${scanner(view.appUrl)}
${worth()}
${sets(view.appUrl)}
${more()}
${devices(view)}
${downloadTable(view.downloads)}
</main>
<div class="wrap">${footer()}</div>
<script type="application/json" id="washes">${washData()}</script>
</body>
</html>
`
}
