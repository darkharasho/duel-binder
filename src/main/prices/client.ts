import type { Language } from '../../shared/languages'

export class PriceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PriceUnavailableError'
  }
}

export interface PriceQuery {
  code: string
  name: string
  set: string
  rarity: string
  lang: Language
}

export interface PriceResult {
  price: number | null
  listingCount: number
  checkedAt: string
}

export interface PriceClient {
  lookup(q: PriceQuery): Promise<PriceResult>
}

const TIMEOUT_MS = 15_000

export function createPriceClient(opts: { url: string; fetchFn?: typeof fetch }): PriceClient {
  const fetchFn = opts.fetchFn ?? fetch
  const base = opts.url.replace(/\/+$/, '')
  return {
    async lookup(q) {
      const params = new URLSearchParams({
        code: q.code,
        name: q.name,
        set: q.set,
        rarity: q.rarity,
        lang: q.lang
      })
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      try {
        const res = await fetchFn(`${base}/v1/price?${params}`, {
          headers: { 'X-Client': 'ygo-collection-tracker' },
          signal: ctrl.signal
        })
        if (res.status !== 200) throw new PriceUnavailableError(`Price service returned ${res.status}`)
        const body = (await res.json()) as Partial<PriceResult> | null
        if (
          !body ||
          typeof body !== 'object' ||
          !(body.price === null || (typeof body.price === 'number' && Number.isFinite(body.price))) ||
          typeof body.listingCount !== 'number' ||
          typeof body.checkedAt !== 'string'
        )
          throw new PriceUnavailableError('Price service returned an unexpected response')
        return { price: body.price, listingCount: body.listingCount, checkedAt: body.checkedAt }
      } catch (e) {
        if (e instanceof PriceUnavailableError) throw e
        throw new PriceUnavailableError('Price service is unreachable')
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
