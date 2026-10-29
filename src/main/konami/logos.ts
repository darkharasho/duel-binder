import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getMeta, setMeta } from '../db/meta'
import { KONAMI_LOGO_PREFIX } from '../../shared/imageSources'

/**
 * English set logos from Konami's European Yu-Gi-Oh! TCG news, where each product announcement's
 * thumbnail is the product's logo (from about 2021 on). Articles are matched to sets by title.
 * The thumbnails sit on white, which the image cache cuts out when it downloads them.
 */
const LIST_URL = 'https://www.konami.com/games/eu/en/topics/list/?type=topics&game=ygotcg&page='
const REPO_URL = 'https://github.com/darkharasho/duel-binder'
export const KONAMI_LOGOS_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const TIMEOUT_MS = 30_000
const MAX_PAGES = 30

/** Announcements whose titles don't name the set they show, by article ID. */
const ARTICLE_SETS: Record<number, string> = {
  16677: 'SDCB',
  17337: 'DUNE',
  17524: 'AGOV',
  17556: 'RA01',
  18492: 'SDWD'
}
/** Sets whose logo doesn't survive the cutout (dark lettering on the white). */
const SKIP_SETS = new Set(['MP22'])
/** Thumbnails shared by many articles, which aren't any one set's logo. */
const GENERIC = /ygo-logo-with-copyright|EN-and-DE-Resized/i
const THUMBNAIL = /^\/(?:games_cms|kde_cms)\/[\w/.-]+\.(?:png|jpe?g)$/i
/** Set names shorter than this (once normalized) are too likely to turn up in unrelated titles. */
const MIN_NAME = 8

export interface Article {
  id: number
  title: string
  /** The thumbnail on img.konami.com; null when there's none or it isn't one of the site's uploads. */
  imageUrl: string | null
}

export interface ArticlePage {
  articles: Article[]
  maxPage: number
}

/** The JSON object starting at `start`, read up to its matching brace. */
function objectAt(text: string, start: number): unknown {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1))
  }
  throw new Error('unterminated JSON')
}

interface RawList {
  max_page?: number
  list?: { post?: { ID?: number; title?: string; thumbnail?: { full?: { url?: string } } } }[]
}

/** The articles a listing page embeds for its script (`data:{"api_name":…,"list":[…]}`). */
export function parseArticleList(html: string): ArticlePage {
  const at = html.indexOf('data:{"api_name"')
  if (at < 0) throw new Error('no article data')
  const raw = objectAt(html, at + 'data:'.length) as RawList
  const articles: Article[] = []
  for (const { post } of raw.list ?? []) {
    if (typeof post?.ID !== 'number' || typeof post.title !== 'string') continue
    const thumb = post.thumbnail?.full?.url
    const imageUrl =
      typeof thumb === 'string' && THUMBNAIL.test(thumb) && !GENERIC.test(thumb)
        ? `${KONAMI_LOGO_PREFIX}${thumb.slice(1)}`
        : null
    articles.push({ id: post.ID, title: post.title, imageUrl })
  }
  return { articles, maxPage: raw.max_page ?? 1 }
}

/** Lowercase words, apostrophes dropped, so "5D&apos;s Decks" meets "5D’s DECKS". */
const words = (s: string): string =>
  ` ${s
    .replace(/&apos;|&#0?39;|&#8217;|['’]/g, '')
    .replace(/&amp;/g, '&')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `

/** 'km-' + first 20 hex chars of sha1(url); null for anything outside img.konami.com. */
export function konamiLogoKey(url: string | null): string | null {
  if (url === null || !url.startsWith(KONAMI_LOGO_PREFIX)) return null
  return `km-${createHash('sha1').update(url).digest('hex').slice(0, 20)}`
}

export function shouldRefreshKonamiLogos(db: Database.Database, now: Date): boolean {
  const last = getMeta(db, 'konami_logos_synced_at')
  if (!last) return true
  const t = Date.parse(last)
  return Number.isNaN(t) || now.getTime() - t >= KONAMI_LOGOS_INTERVAL_MS
}

/** Set name → logo URL: each set's newest announcement whose title names it (longest name wins). */
export function matchArticles(
  articles: Article[],
  sets: { set_name: string; set_code: string }[]
): Map<string, string> {
  const byCode = new Map(sets.map((s) => [s.set_code.toUpperCase(), s.set_name]))
  const named = sets
    .filter((s) => !SKIP_SETS.has(s.set_code.toUpperCase()))
    .map((s) => ({ name: s.set_name, key: words(s.set_name) }))
    .filter((s) => s.key.length - 2 >= MIN_NAME)
    .sort((a, b) => b.key.length - a.key.length)
  const out = new Map<string, string>()
  for (const a of articles) {
    if (!a.imageUrl) continue
    const code = ARTICLE_SETS[a.id]
    const title = words(a.title)
    const set = code ? byCode.get(code) : named.find((s) => title.includes(s.key))?.name
    if (set && !out.has(set)) out.set(set, a.imageUrl)
  }
  return out
}

/** Never rejects. Returns how many English sets have a Konami logo afterwards. */
export async function refreshKonamiLogos(
  db: Database.Database,
  opts: { version: string; fetchFn?: typeof fetch; now?: Date }
): Promise<number> {
  const fetchFn = opts.fetchFn ?? fetch
  const headers = { 'User-Agent': `DuelBinder/${opts.version} (${REPO_URL})` }
  const articles: Article[] = []
  try {
    for (let page = 1, last = 1; page <= Math.min(last, MAX_PAGES); page++) {
      const res = await fetchFn(`${LIST_URL}${page}`, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = parseArticleList(await res.text())
      articles.push(...parsed.articles)
      last = parsed.maxPage
    }
  } catch (e) {
    console.warn('Konami logos failed:', e instanceof Error ? e.message : String(e))
    return 0 // keep what's stored; try again next start
  }

  const sets = db.prepare("SELECT set_name, set_code FROM sets WHERE game = 'ygo' AND language = 'en'").all() as {
    set_name: string
    set_code: string
  }[]
  const logos = matchArticles(articles, sets)
  const insert = db.prepare(
    'INSERT OR IGNORE INTO konami_logos (set_name, image_url, image_key) VALUES (?, ?, ?)'
  )
  let n = 0
  db.transaction(() => {
    db.exec('DELETE FROM konami_logos')
    for (const [set, url] of logos) {
      const key = konamiLogoKey(url)
      if (key) n += insert.run(set, url, key).changes
    }
  })()
  setMeta(db, 'konami_logos_synced_at', (opts.now ?? new Date()).toISOString())
  console.info(`Konami logos: ${n} sets from ${articles.length} articles`)
  return n
}
