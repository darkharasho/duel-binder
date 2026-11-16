/**
 * Simplified Chinese card art from PokiPair (pokipair.com), an Irish shop whose set lists picture
 * every card. Read once, politely, by the catalog job (pokipairMirror.ts), which keeps a copy in
 * R2: nothing links to PokiPair. The owner read the site's terms and chose to use it (2026-11-15).
 *
 * A set page lists `li.pp-card` items: `data-number` ("006/207"), `data-variant` (normal, holo,
 * full-art, ace, pokeball-reverse, masterball-reverse), the full picture in `data-full` and
 * "006/207 · Illumise · Common" in `data-caption`. A Gem Pack page names neither number nor card:
 * its pictures run in the set's own order.
 */
import { sameCardName } from './match'

export const POKIPAIR_HUB = 'https://www.pokipair.com/simplified-chinese-pokemon-set-list/'

/** One set on the hub: its page and the full size of its pack picture. */
export interface PpSet {
  slug: string
  url: string
  pack: string | null
}

/** One picture on a set page. `number` without its set total ("006"); null on a Gem Pack page. */
export interface PpCard {
  number: string | null
  variant: string
  url: string
  name: string | null
}

/** One zh-hans card of the catalog: its source id, number ("006", "0101") and English name. */
export interface ZhCatalogCard {
  sourceId: string
  number: string
  name: string
}

const decode = (s: string): string =>
  s
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&quot;/g, '"')

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m ? decode(m[1]) : null
}

/** The set pages the hub lists, in its order. */
export function parseHub(html: string): PpSet[] {
  const out: PpSet[] = []
  for (const li of html.match(/<li class="[^"]*\bpp-set-card\b[^"]*">[\s\S]*?<\/li>/g) ?? []) {
    const href = /href="(https:\/\/www\.pokipair\.com\/([a-z0-9-]+)\/)"/.exec(li)
    if (!href) continue
    const src = /<img[^>]*\ssrc="([^"]+)"/.exec(li)?.[1] ?? null
    out.push({
      slug: href[2],
      url: href[1],
      pack: src ? src.replace(/-\d+x\d+(\.\w+)$/, '$1') : null
    })
  }
  return out
}

/** A set page's title and pictures. */
export function parseSetPage(html: string): { title: string; cards: PpCard[] } {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ''
  const title = decode(h1.replace(/<[^>]+>/g, '')).trim()
  const cards: PpCard[] = []
  for (const li of html.match(/<li class="pp-card"[\s\S]*?<\/li>/g) ?? []) {
    const open = /<li[^>]*>/.exec(li)![0]
    const button = /<button[^>]*class="pp-card-open"[^>]*>/.exec(li)?.[0] ?? ''
    const url = attr(button, 'data-full')
    if (!url) continue
    const rawNumber = attr(open, 'data-number') ?? ''
    const number = rawNumber ? rawNumber.split('/')[0].trim() : null
    const caption = attr(button, 'data-caption') ?? ''
    const parts = caption.split(' · ')
    const name = number !== null && parts.length >= 2 ? parts[1].trim() || null : null
    cards.push({ number, variant: attr(open, 'data-variant') ?? 'normal', url, name })
  }
  return { title, cards }
}

/** Pages whose slug names no code, or names it unlike the rest. */
const SLUG_SETS: Readonly<Record<string, string>> = {
  'crystal-gathering-csv95-card-list': 'CSV9.5C',
  'gem-pack-volume-one-card-list': 'CBB1C',
  'cs-ol-promo-pack-card-list': 'CS0LC',
  '30th-anniversary-30thc-card-list': '30thC',
  'return-of-the-dragon-set-list': 'CSFC',
  'shadow-of-glory-set-list': 'CS5.5C',
  'final-flame-dance-set-list': 'CS4.5C',
  'scorching-skies-set-list': 'CS3.5C',
  'striking-competition-set-list-c': 'CSM2.5C',
  // The four waves of 151, one set in the catalog.
  'collect-151-gathering': '151C',
  'collect-151-surprise': '151C',
  'collect-151-hope-card-list': '151C',
  'collect-151-journey-card-list-simplified-chinese-pokemon': '151C'
}

/** The catalog's set id of a page from its slug; null unless it is one of `known`. */
export function setIdOf(slug: string, known: ReadonlySet<string>): string | null {
  const ok = (id: string | null): string | null => (id !== null && known.has(id) ? id : null)
  if (SLUG_SETS[slug]) return ok(SLUG_SETS[slug])
  const gem = /^gem-pack-vol-(\d+)-/.exec(slug)
  if (gem) return ok(`CBB${Number(gem[1])}C`)
  const letter = /^cs-([a-z])-promo/.exec(slug)
  if (letter) return ok(`CS${letter[1].toUpperCase()}C`)
  const words = slug.split('-')
  for (let i = 0; i < words.length; i++) {
    const w = /^(csvl|csv|csm|cs)(\d+)([a-z]?)$/.exec(words[i])
    if (w) {
      const [, prefix, n, sub] = w
      // "csv10-6c", "cs6-5", "cs4-1c": the number after the dash is the code's decimal.
      const dec = !sub ? /^(\d)c?$/.exec(words[i + 1] ?? '') : null
      const code = `${prefix.toUpperCase()}${n}${dec ? `.${dec[1]}` : ''}${sub}C`
      return ok(code)
    }
    const bare = /^cs([a-z])$/.exec(words[i])
    if (bare) return ok(`CS${bare[1].toUpperCase()}C`)
  }
  return null
}

/** Which picture of a number is the card's own: the plain one first; never a reverse pattern. */
const VARIANT_ORDER = ['normal', 'holo', 'full-art', 'ace']

const bareNumber = (n: string): string =>
  n
    .split('/')[0]
    .replace(/^0+(?=.)/, '')
    .toUpperCase()

/**
 * Each catalog card's picture on a page, by source id. A numbered page matches by number and
 * name, and a card whose name disagrees gets nothing. A page without numbers (a Gem Pack's) is
 * taken in the catalog's order, only when it has exactly as many pictures as the set has cards.
 */
export function matchCards(page: PpCard[], cards: ZhCatalogCard[]): Map<string, string> {
  const out = new Map<string, string>()
  if (page.length === 0) return out
  if (page.every((c) => c.number === null)) {
    if (page.length !== cards.length) return out
    const ordered = [...cards].sort((a, b) =>
      a.number.localeCompare(b.number, 'en', { numeric: true })
    )
    ordered.forEach((c, i) => out.set(c.sourceId, page[i].url))
    return out
  }
  const byNumber = new Map<string, PpCard[]>()
  for (const c of page) {
    if (c.number === null || !VARIANT_ORDER.includes(c.variant)) continue
    const k = bareNumber(c.number)
    byNumber.set(k, [...(byNumber.get(k) ?? []), c])
  }
  const ours = new Map<string, ZhCatalogCard[]>()
  for (const c of cards) {
    const k = bareNumber(c.number)
    ours.set(k, [...(ours.get(k) ?? []), c])
  }
  for (const [k, pics] of byNumber) {
    const mine = ours.get(k) ?? []
    if (mine.length !== 1) continue
    const pick = [...pics].sort(
      (a, b) => VARIANT_ORDER.indexOf(a.variant) - VARIANT_ORDER.indexOf(b.variant)
    )[0]
    if (!pick.name || !sameCardName(mine[0].name, pick.name)) continue
    out.set(mine[0].sourceId, pick.url)
  }
  return out
}

/** The hand-art id of a source id: "zh-hans/CSV9.5C-001" is "zh-hans-csv9-5c-001". */
export const handId = (sourceId: string): string =>
  sourceId.toLowerCase().replace(/[^a-z0-9]+/g, '-')
