import { EBAY_WORDS, buildQuery, titleMatches, askingPrice } from './price.js'

const OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search'
const OAUTH_BODY =
  'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
const CACHE_TTL = 604800
const ATTEMPTS = 3

let cachedToken = null // { value, expiresAt }

// Test-only.
export function resetTokenCache() {
  cachedToken = null
}

const respond = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retries network errors, 429 and 5xx: 3 attempts, 1 s then 2 s.
async function fetchWithRetry(url, init) {
  let res = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      res = await fetch(url, init)
      if (res.status !== 429 && res.status < 500) return res
    } catch {
      res = null
    }
    if (attempt < ATTEMPTS - 1) await sleep(1000 * 2 ** attempt)
  }
  return res
}

async function getToken(env) {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value
  const res = await fetchWithRetry(OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.EBAY_APP_ID}:${env.EBAY_CERT_ID}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: OAUTH_BODY
  })
  if (!res || res.status !== 200) throw new Error(`oauth ${res ? res.status : 'network'}`)
  const data = await res.json().catch(() => null)
  if (!data || !data.access_token) throw new Error('oauth malformed')
  const ttl = Number(data.expires_in) || 7200
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 }
  return cachedToken.value
}

async function search(env, query) {
  const token = await getToken(env)
  const params = new URLSearchParams({ q: query, category_ids: '31395', limit: '50' })
  const res = await fetchWithRetry(`${BROWSE_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
  })
  if (!res || res.status !== 200) {
    if (res && res.status === 401) cachedToken = null
    throw new Error(`search ${res ? res.status : 'network'}`)
  }
  const data = await res.json().catch(() => null)
  if (!data) throw new Error('search malformed')
  return data.itemSummaries ?? []
}

function matchingPrices(items, ref) {
  return items
    .filter((i) => titleMatches(i.title, ref) && i.price?.currency === 'USD')
    .map((i) => Number.parseFloat(i.price.value))
    .filter(Number.isFinite)
}

async function lookup(env, params) {
  let prices = matchingPrices(await search(env, buildQuery(params)), params)
  if (prices.length < 2 && params.rarity) {
    prices = matchingPrices(await search(env, buildQuery({ ...params, rarity: '' })), params)
  }
  return {
    ...askingPrice(prices),
    currency: 'USD',
    checkedAt: new Date().toISOString()
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET') return respond({ error: 'method not allowed' }, 405)
    const url = new URL(request.url)
    if (url.pathname !== '/v1/price') return respond({ error: 'not found' }, 404)

    const q = url.searchParams
    const params = {
      code: (q.get('code') ?? '').trim(),
      name: (q.get('name') ?? '').trim(),
      set: (q.get('set') ?? '').trim(),
      rarity: (q.get('rarity') ?? '').trim(),
      lang: q.get('lang') ?? ''
    }
    if (
      request.headers.get('X-Client') !== 'ygo-collection-tracker' ||
      !Object.hasOwn(EBAY_WORDS, params.lang) ||
      !params.name
    ) {
      return respond({ error: 'bad request' }, 400)
    }

    const key = [
      'v1',
      params.code,
      params.name.toLowerCase(),
      params.set,
      params.rarity,
      params.lang
    ].join('|')
    const hit = await env.PRICES.get(key)
    if (hit) return new Response(hit, { headers: { 'content-type': 'application/json' } })

    try {
      const body = JSON.stringify(await lookup(env, params))
      await env.PRICES.put(key, body, { expirationTtl: CACHE_TTL })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    } catch (e) {
      // Status line only: never URLs, headers, bodies or env values.
      console.error(
        'ebay lookup failed',
        String(e?.message ?? '')
          .split(' ')
          .slice(0, 2)
          .join(' ')
      )
      return respond({ error: 'upstream' }, 502)
    }
  }
}
