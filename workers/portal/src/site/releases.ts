export interface Asset {
  name: string
  size: number
  url: string
}
export interface Downloads {
  version: string | null
  windows: Asset | null
  mac: Asset | null
  linux: Asset | null
}

export const RELEASES_FALLBACK = 'https://github.com/darkharasho/duel-binder/releases/latest'

const API_URL = 'https://api.github.com/repos/darkharasho/duel-binder/releases/latest'
const OK_TTL_MS = 60 * 60_000
const FAIL_TTL_MS = 5 * 60_000

const empty = (): Downloads => ({ version: null, windows: null, mac: null, linux: null })

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function pickDownloads(release: unknown): Downloads {
  if (!isRecord(release)) return empty()
  const out = empty()
  if (typeof release.tag_name === 'string') out.version = release.tag_name.replace(/^v/, '')
  const assets: Asset[] = []
  if (Array.isArray(release.assets)) {
    for (const a of release.assets) {
      if (
        isRecord(a) &&
        typeof a.name === 'string' &&
        typeof a.size === 'number' &&
        typeof a.browser_download_url === 'string'
      ) {
        assets.push({ name: a.name, size: a.size, url: a.browser_download_url })
      }
    }
  }
  out.windows = assets.find((a) => a.name.endsWith('-setup.exe')) ?? null
  out.mac = assets.find((a) => a.name.endsWith('.dmg')) ?? null
  out.linux = assets.find((a) => a.name.endsWith('.AppImage')) ?? null
  return out
}

/** `token` is an optional GitHub PAT; without it the API allows 60 requests an hour per IP. */
export function createReleaseSource(deps: {
  fetch: typeof fetch
  now: () => Date
  token?: string
}): () => Promise<Downloads> {
  let lastGood: Downloads | null = null
  let cached: Downloads | null = null
  let expires = 0
  let pending: Promise<Downloads> | null = null

  async function refresh(): Promise<Downloads> {
    const t = deps.now().getTime()
    try {
      const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'user-agent': 'duel-binder-portal'
      }
      if (deps.token) headers.authorization = `Bearer ${deps.token}`
      const res = await deps.fetch(API_URL, {
        headers,
        signal: AbortSignal.timeout(3000)
      })
      if (!res.ok) throw new Error(`GitHub responded ${res.status}`)
      const result = pickDownloads(await res.json())
      if (result.version === null) throw new Error('Release has no tag_name')
      lastGood = result
      cached = result
      expires = t + OK_TTL_MS
    } catch {
      // Keep serving the last good result; re-check after the short failure TTL.
      cached = lastGood ?? empty()
      expires = t + FAIL_TTL_MS
    }
    return cached
  }

  return async () => {
    if (cached && deps.now().getTime() < expires) return cached
    pending ??= refresh().finally(() => {
      pending = null
    })
    return pending
  }
}
