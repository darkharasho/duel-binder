export interface Asset { name: string; size: number; url: string }
export interface Downloads { version: string | null; windows: Asset | null; mac: Asset | null; linux: Asset | null }

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
      if (isRecord(a) && typeof a.name === 'string' && typeof a.size === 'number' && typeof a.browser_download_url === 'string') {
        assets.push({ name: a.name, size: a.size, url: a.browser_download_url })
      }
    }
  }
  out.windows = assets.find((a) => a.name.endsWith('-setup.exe')) ?? null
  out.mac = assets.find((a) => a.name.endsWith('.dmg')) ?? null
  out.linux = assets.find((a) => a.name.endsWith('.AppImage')) ?? null
  return out
}

export function createReleaseSource(deps: { fetch: typeof fetch; now: () => Date }): () => Promise<Downloads> {
  let cached: Downloads | null = null
  let expires = 0

  return async () => {
    const t = deps.now().getTime()
    if (cached && t < expires) return cached
    let result: Downloads
    let ttl = OK_TTL_MS
    try {
      const res = await deps.fetch(API_URL, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'duel-binder-portal' },
      })
      if (!res.ok) throw new Error(`GitHub responded ${res.status}`)
      result = pickDownloads(await res.json())
    } catch {
      result = empty()
      ttl = FAIL_TTL_MS
    }
    cached = result
    expires = t + ttl
    return result
  }
}
