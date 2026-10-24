import type { ApiCard } from './mapCard'

export type { ApiCard }

const CARD_INFO_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php'
const DB_VERSION_URL = 'https://db.ygoprodeck.com/api/v7/checkDBVer.php'
const TIMEOUT_MS = 120_000

export class YgoApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YgoApiError'
  }
}

export interface YgoClient {
  fetchCardInfo(): Promise<ApiCard[]>
  fetchDbVersion(): Promise<{ databaseVersion: string; lastUpdate: string }>
}

export function createYgoClient(fetchFn: typeof fetch = fetch): YgoClient {
  async function getJson(url: string): Promise<unknown> {
    let res: Response
    try {
      res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (e) {
      throw new YgoApiError(`Request failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!res.ok) throw new YgoApiError(`YGOPRODeck responded with HTTP ${res.status}`)
    try {
      return await res.json()
    } catch (e) {
      throw new YgoApiError(
        `Invalid JSON from YGOPRODeck: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  return {
    async fetchCardInfo() {
      const body = (await getJson(CARD_INFO_URL)) as { data?: unknown } | null
      if (!body || !Array.isArray(body.data)) {
        throw new YgoApiError('Unexpected YGOPRODeck payload: "data" is not an array')
      }
      return body.data as ApiCard[]
    },
    async fetchDbVersion() {
      const body = await getJson(DB_VERSION_URL)
      const first = Array.isArray(body) ? body[0] : undefined
      if (!first || typeof first.database_version !== 'string') {
        throw new YgoApiError('Unexpected YGOPRODeck version payload')
      }
      return {
        databaseVersion: first.database_version,
        lastUpdate: String(first.last_update ?? '')
      }
    }
  }
}
