import { RELEASES_FALLBACK, type Asset, type Downloads } from './releases'
import type { Os } from './os'

export interface PageView { downloads: Downloads; os: Os | null; appUrl: string }

export const REPO_URL = 'https://github.com/darkharasho/duel-binder'
const TITLE = 'Duel Binder — a binder for your Yu-Gi-Oh! and Pokémon cards'
const DESCRIPTION =
  'Duel Binder is a desktop app for cataloging your Yu-Gi-Oh! and Pokémon cards by set, rarity and condition, with prices that update on their own.'
const LEAD =
  "Log what you own by set, rarity and condition. Prices update on their own. It runs on your computer and works offline. Sign in with Discord to see your friends' collections on the web."

// The favicon, drawn for small sizes (resources/brand/small.svg); so there is only one mark to keep.
export const MARK = `<img src="/favicon.svg" width="28" height="28" alt="">`

const OS_LABEL: Record<Os, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' }

export const esc = (s: string): string =>
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
<h1>A binder for your <span class="nowrap">Yu-Gi-Oh!</span> and Pokémon cards.</h1>
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
      'Yu-Gi-Oh! and Pokémon',
      'Both games in one app. Switch between them from the sidebar, each with its own collection and prices.',
      { src: '/shots/collection-pokemon.webp', alt: 'The Collection page showing Pokémon cards sorted by value, with filters for category, type, stage, rarity, set and version.' },
    ),
    feature(
      '',
      'Finish your sets',
      'Every set and printing from the full catalog, with a checklist of what you still need.',
      { src: '/shots/sets.webp', alt: 'The Sets page showing the Pokémon Base Set with 72 of 102 cards owned; the cards still missing are greyed out.' },
    ),
    feature(
      '',
      'Friends',
      "Sign in with Discord, add your friends, and look through each other's collections at app.duelbinder.com.",
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

export function footer(): string {
  return `<footer><span>Duel Binder is not affiliated with Konami or The Pokémon Company. Card data and images from YGOPRODeck and TCGdex.</span><span class="links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="${REPO_URL}">GitHub</a></span></footer>`
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
<script src="/account.js" defer></script>
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
