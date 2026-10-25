import { RELEASES_FALLBACK, type Asset, type Downloads } from './releases'
import type { Os } from './os'

export interface PageView { downloads: Downloads; os: Os | null; appUrl: string }

const REPO_URL = 'https://github.com/darkharasho/duel-binder'
const TITLE = 'Duel Binder — a binder for your Yu-Gi-Oh! collection'
const DESCRIPTION =
  'Duel Binder is a desktop app for cataloging your Yu-Gi-Oh! collection by set, rarity and condition, with prices that update on their own.'
const LEAD =
  "Log what you own by set, rarity and condition. Prices update on their own. It runs on your computer and works offline. Sign in with Discord to see your friends' binders on the web."

// Inline copy of resources/brand/square.svg at 28 px.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="28" height="28" aria-hidden="true"><defs><radialGradient id="glow" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#6d28d9"/><stop offset="1" stop-color="#1e1047"/></radialGradient><linearGradient id="au" gradientUnits="userSpaceOnUse" x1="0" y1="12" x2="0" y2="50"><stop offset="0" stop-color="#fbe9b0"/><stop offset=".45" stop-color="#ebbd5c"/><stop offset="1" stop-color="#c08a2a"/></linearGradient><linearGradient id="auf" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="62"><stop offset="0" stop-color="#fbe9b0"/><stop offset=".5" stop-color="#e2b14d"/><stop offset="1" stop-color="#b07d22"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#glow)"/><rect x="4.5" y="4.5" width="55" height="55" rx="10.5" fill="none" stroke="url(#auf)" stroke-width="1.8"/><rect x="7.6" y="7.6" width="48.8" height="48.8" rx="8" fill="none" stroke="url(#auf)" stroke-width=".8" opacity=".6"/><g transform="translate(32 32) scale(1.04) translate(-32 -32)"><g transform="translate(-0.7 3.2)"><path d="M14 18.5C23 12.5 38 11.5 50 14.6Q51.4 15.7 50 17C38 14.2 23 15.6 14.8 21.2Q13.3 20 14 18.5Z" fill="url(#au)"/><g fill="none" stroke="url(#au)" stroke-width="2.8" stroke-linejoin="round"><path d="M14.5 28.5C21 20.8 36 19.8 46 26.5C37 32.4 23 33.4 14.5 28.5Z"/><path d="M46 26.6H52" stroke-linecap="round"/><path d="M27.2 32.6L26.4 43.6" stroke-linecap="round" stroke-width="3"/><path d="M33.4 32.2C35 39 38 43.5 43 43.5C47 43.5 48.5 40 46.5 37.8C45 36.2 42.5 36.8 42.3 38.8" stroke-linecap="round"/></g><circle cx="29" cy="26.6" r="4" fill="url(#au)"/></g></g></svg>`

const OS_LABEL: Record<Os, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' }

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Decimal megabytes, rounded. */
export function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`
}

function nav(appUrl: string): string {
  return `<nav><div class="wrap navin">
<a class="brand" href="/">${MARK}Duel Binder</a>
<a href="#features">Features</a><a href="#download">Download</a><a href="${REPO_URL}">GitHub</a>
<span class="grow"></span><a class="signin" href="${esc(appUrl)}">Sign in</a>
</div></nav>`
}

function hero(v: PageView): string {
  const { downloads, os, appUrl } = v
  const asset = os ? downloads[os] : null
  const label = os ? `Download for ${OS_LABEL[os]}` : 'Download'
  const href = os ? (asset ? asset.url : RELEASES_FALLBACK) : '#download'
  const meta = `${downloads.version ? `v${downloads.version} · ` : ''}Windows, macOS, Linux · free`
  return `<header class="hero">
<h1>A binder for your <span class="nowrap">Yu-Gi-Oh!</span> collection.</h1>
<p class="lead">${LEAD}</p>
<div class="actions"><a class="btn pri" href="${esc(href)}">${label}</a><a class="btn out" href="${esc(appUrl)}">Open the web app</a></div>
<div class="meta mono">${esc(meta)}</div>
</header>
<figure class="frame shot"><img src="/shots/collection.webp" width="2560" height="1600" alt="The Collection page of the Duel Binder desktop app: a grid of cards sorted by value, with filters for type, set, rarity and condition."></figure>`
}

function feature(id: string, heading: string, body: string, img?: { src: string; alt: string }): string {
  const shot = img
    ? `<figure class="frame shot"><img src="${img.src}" width="2560" height="1600" alt="${esc(img.alt)}" loading="lazy"></figure>`
    : ''
  return `<section class="f"${id ? ` id="${id}"` : ''}><div class="ft"><h2>${heading}</h2><p>${body}</p></div>${shot}</section>`
}

function features(): string {
  return [
    feature(
      'features',
      "What it's worth",
      'Total value, card counts and your most valuable pulls, from the latest prices.',
      { src: '/shots/dashboard.webp', alt: 'The Dashboard page: the total value of the collection over time, with card counts and the most valuable cards.' },
    ),
    feature(
      '',
      'Finish your sets',
      'Every set and printing from the full catalog, with a checklist of what you still need.',
      { src: '/shots/sets.webp', alt: 'The Sets page showing Metal Raiders with 101 of 144 cards owned; the cards still missing are greyed out.' },
    ),
    feature(
      '',
      'Friends',
      "Sign in with Discord, add your friends, and look through each other's binders at app.duelbinder.com.",
    ),
  ].join('\n')
}

function downloadRow(name: string, asset: Asset | null, note = ''): string {
  const file = asset ? `${esc(asset.name)} · ${formatSize(asset.size)}` : ''
  return `<tr><td class="plat">${name}</td><td class="m mono">${file}${note}</td><td class="act"><a class="btn out sm" href="${esc(asset ? asset.url : RELEASES_FALLBACK)}">Download</a></td></tr>`
}

function downloadTable(d: Downloads): string {
  return `<section class="f" id="download"><div class="ft"><h2>Download</h2><p>The app checks for updates itself.</p></div>
<table>
${downloadRow('Windows', d.windows)}
${downloadRow('macOS', d.mac, d.mac ? ' · Apple silicon &amp; Intel' : '')}
${downloadRow('Linux', d.linux)}
</table></section>`
}

function footer(): string {
  return `<footer><span>Duel Binder is not affiliated with Konami. Card data and images from YGOPRODeck.</span><a href="${REPO_URL}">GitHub</a></footer>`
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
<link rel="stylesheet" href="/site.css">
</head>
<body>
<div class="wash" aria-hidden="true"><div></div></div>
${nav(view.appUrl)}
<main class="wrap">
${hero(view)}
${features()}
${downloadTable(view.downloads)}
</main>
<div class="wrap">${footer()}</div>
</body>
</html>
`
}
