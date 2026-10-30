const API_URL = 'https://yugipedia.com/api.php'
const REPO_URL = 'https://github.com/darkharasho/duel-binder'
const IMAGE_URL_PREFIX = 'https://ms.yugipedia.com/'
const SET_LIST_NAMESPACE = '3006'
// Yugipedia can take 20-30s to answer a batch, so give it room before retrying.
const TIMEOUT_MS = 90_000
const MIN_GAP_MS = 500
const CHUNK_SIZE = 50
const BACKOFF_MS = [2000, 4000, 8000]

export class YugipediaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YugipediaError'
  }
}

export interface YugipediaClient {
  /** Every title in namespace 3006 (follows apcontinue). */
  listSetListTitles(): Promise<string[]>
  /** Wikitext by requested title (redirects followed; missing pages absent). Chunks of 50. */
  fetchPages(titles: string[]): Promise<Map<string, string>>
  /** File name (no "File:") -> URL, only for URLs starting with https://ms.yugipedia.com/. Chunks of 50. */
  fetchImageUrls(files: string[]): Promise<Map<string, string>>
  /**
   * File names (no "File:") used on each requested page (redirects followed; missing and invalid
   * titles absent). Chunks of 50.
   */
  listPageImages(titles: string[]): Promise<Map<string, string[]>>
  /** Every article in a category, with its page id (follows cmcontinue). */
  listCategoryPages(category: string): Promise<{ pageId: number; title: string }[]>
  /** File name (no "File:") -> its page id, for files that exist. Chunks of 50. */
  filePageIds(files: string[]): Promise<Map<string, number>>
  /**
   * File page id -> the file's URL (as fetchImageUrls allows them). The original only: Yugipedia's
   * API refuses to make thumbnails for anyone but its own pages. Chunks of 50.
   */
  imageUrlsByPageId(pageIds: number[]): Promise<Map<number, string>>
}

interface FromTo {
  from: string
  to: string
}

interface ApiPage {
  title: string
  pageid?: number
  missing?: boolean
  /** A title MediaWiki can't hold ("<", "[", ...). */
  invalid?: boolean
  revisions?: { slots?: { main?: { content?: string } } }[]
  imageinfo?: { url?: string }[]
  images?: { title: string }[]
}

interface ApiBody {
  error?: { code?: string }
  continue?: { apcontinue?: string; cmcontinue?: string; imcontinue?: string; continue?: string }
  query?: {
    allpages?: { title: string }[]
    categorymembers?: { pageid: number; title: string }[]
    pages?: ApiPage[]
    normalized?: FromTo[]
    redirects?: FromTo[]
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function createYugipediaClient(opts: {
  version: string
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}): YugipediaClient {
  const fetchFn = opts.fetchFn ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const userAgent = `DuelBinder/${opts.version} (${REPO_URL})`
  let lastStart: number | null = null

  async function paceThenFetch(url: string): Promise<Response> {
    if (lastStart !== null) {
      const wait = lastStart + MIN_GAP_MS - now()
      if (wait > 0) await sleep(wait)
    }
    lastStart = now()
    return fetchFn(url, {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  }

  async function request(params: Record<string, string>): Promise<ApiBody> {
    const qs = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })
    const url = `${API_URL}?${qs.toString()}`
    let failure = 'network error'
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      let retryAfterMs = 0
      try {
        const res = await paceThenFetch(url)
        if (res.status === 429 || res.status >= 500) {
          failure = `HTTP ${res.status}`
          const ra = Number.parseInt(res.headers.get('Retry-After') ?? '', 10)
          if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra * 1000
        } else if (!res.ok) {
          throw new YugipediaError(`HTTP ${res.status}`)
        } else {
          let body: ApiBody
          try {
            body = (await res.json()) as ApiBody
          } catch {
            throw new YugipediaError('invalid response')
          }
          if (body.error?.code === 'maxlag') {
            failure = 'maxlag'
          } else if (body.error) {
            throw new YugipediaError(`API error: ${String(body.error.code)}`)
          } else {
            return body
          }
        }
      } catch (e) {
        if (e instanceof YugipediaError) throw e
        failure = 'network error'
      }
      if (attempt < BACKOFF_MS.length) await sleep(Math.max(BACKOFF_MS[attempt], retryAfterMs))
    }
    throw new YugipediaError(failure)
  }

  /** Resolve a requested title through normalized then redirects to the result title. */
  function resolver(body: ApiBody): (requested: string) => string {
    const norm = new Map((body.query?.normalized ?? []).map((n) => [n.from, n.to]))
    const redir = new Map((body.query?.redirects ?? []).map((n) => [n.from, n.to]))
    return (t) => {
      const n = norm.get(t) ?? t
      return redir.get(n) ?? n
    }
  }

  return {
    async listSetListTitles() {
      const titles: string[] = []
      let cont: string | undefined
      do {
        const params: Record<string, string> = {
          action: 'query',
          list: 'allpages',
          apnamespace: SET_LIST_NAMESPACE,
          apfilterredir: 'nonredirects',
          aplimit: 'max'
        }
        if (cont) params.apcontinue = cont
        const body = await request(params)
        for (const p of body.query?.allpages ?? []) titles.push(p.title)
        cont = body.continue?.apcontinue
      } while (cont)
      return titles
    },

    async fetchPages(titles) {
      const out = new Map<string, string>()
      for (const part of chunk(titles, CHUNK_SIZE)) {
        const body = await request({
          action: 'query',
          prop: 'revisions',
          rvprop: 'content',
          rvslots: 'main',
          redirects: '1',
          titles: part.join('|')
        })
        const byTitle = new Map((body.query?.pages ?? []).map((p) => [p.title, p]))
        const resolve = resolver(body)
        for (const t of part) {
          const content = byTitle.get(resolve(t))?.revisions?.[0]?.slots?.main?.content
          if (typeof content === 'string') out.set(t, content)
        }
      }
      return out
    },

    async listPageImages(titles) {
      const out = new Map<string, string[]>()
      for (const part of chunk(titles, CHUNK_SIZE)) {
        const byTitle = new Map<string, string[]>()
        let resolve: (t: string) => string = (t) => t
        let cont: Record<string, string> = {}
        do {
          const body = await request({
            action: 'query',
            prop: 'images',
            imlimit: 'max',
            redirects: '1',
            titles: part.join('|'),
            ...cont
          })
          if (Object.keys(cont).length === 0) resolve = resolver(body)
          for (const p of body.query?.pages ?? []) {
            // A missing page is listed with no images; leave it out so callers can try another title.
            if (p.missing || p.invalid) continue
            const files = byTitle.get(p.title) ?? []
            for (const i of p.images ?? []) files.push(i.title.replace(/^File:/, ''))
            byTitle.set(p.title, files)
          }
          cont = body.continue?.imcontinue
            ? { imcontinue: body.continue.imcontinue, continue: body.continue.continue ?? '' }
            : {}
        } while (cont.imcontinue)
        for (const t of part) {
          const files = byTitle.get(resolve(t))
          if (files) out.set(t, files)
        }
      }
      return out
    },

    async fetchImageUrls(files) {
      const out = new Map<string, string>()
      for (const part of chunk(files, CHUNK_SIZE)) {
        const body = await request({
          action: 'query',
          prop: 'imageinfo',
          iiprop: 'url',
          titles: part.map((f) => `File:${f}`).join('|')
        })
        const byTitle = new Map((body.query?.pages ?? []).map((p) => [p.title, p]))
        const resolve = resolver(body)
        for (const f of part) {
          const url = byTitle.get(resolve(`File:${f}`))?.imageinfo?.[0]?.url
          if (typeof url === 'string' && url.startsWith(IMAGE_URL_PREFIX)) out.set(f, url)
        }
      }
      return out
    },

    async listCategoryPages(category) {
      const pages: { pageId: number; title: string }[] = []
      let cont: string | undefined
      do {
        const params: Record<string, string> = {
          action: 'query',
          list: 'categorymembers',
          cmtitle: category,
          cmnamespace: '0',
          cmlimit: 'max'
        }
        if (cont) params.cmcontinue = cont
        const body = await request(params)
        for (const p of body.query?.categorymembers ?? [])
          pages.push({ pageId: p.pageid, title: p.title })
        cont = body.continue?.cmcontinue
      } while (cont)
      return pages
    },

    async filePageIds(files) {
      const out = new Map<string, number>()
      for (const part of chunk(files, CHUNK_SIZE)) {
        const body = await request({
          action: 'query',
          titles: part.map((f) => `File:${f}`).join('|')
        })
        const byTitle = new Map((body.query?.pages ?? []).map((p) => [p.title, p]))
        const resolve = resolver(body)
        for (const f of part) {
          const id = byTitle.get(resolve(`File:${f}`))?.pageid
          if (typeof id === 'number' && id > 0) out.set(f, id)
        }
      }
      return out
    },

    async imageUrlsByPageId(pageIds) {
      const out = new Map<number, string>()
      for (const part of chunk(pageIds, CHUNK_SIZE)) {
        const body = await request({
          action: 'query',
          prop: 'imageinfo',
          iiprop: 'url',
          pageids: part.join('|')
        })
        for (const p of body.query?.pages ?? []) {
          const url = p.imageinfo?.[0]?.url
          if (typeof p.pageid === 'number' && url?.startsWith(IMAGE_URL_PREFIX))
            out.set(p.pageid, url)
        }
      }
      return out
    }
  }
}
