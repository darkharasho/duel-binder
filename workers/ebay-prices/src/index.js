import {
  EBAY_WORDS,
  buildQuery,
  titleMatches,
  isSingleCard,
  namesOtherRarity,
  namesLongerRarity,
  matchesTone,
  askingPrice
} from './price.js'
import { setPrices } from './set.js'

const OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search'
const OAUTH_BODY =
  'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
const CACHE_TTL = 604800
const ATTEMPTS = 3
const MAX_FIELD = 200
const QUOTA_URL =
  'https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_context=buy&api_name=browse'
const SET_PAGE = 200
const SET_MAX_PAGES = 5
const SET_LANGS = new Set(['ja', 'ko', 'zh-hans', 'zh-hant', 'ae'])
// 'ygo-collection-tracker' is what app versions before the Duel Binder rename send.
const CLIENTS = new Set(['duel-binder', 'ygo-collection-tracker'])

let cachedToken = null // { value, expiresAt }

// Test-only.
export function resetTokenCache() {
  cachedToken = null
}

async function cacheKey(p) {
  const joined = ['v3', p.code, p.name.toLowerCase(), p.set, p.rarity, p.lang].join('|')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joined))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `v3:${hex}`
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

async function search(env, query, { offset = 0, limit = 50 } = {}) {
  const token = await getToken(env)
  const params = new URLSearchParams({ q: query, category_ids: '31395', limit: String(limit) })
  if (offset) params.set('offset', String(offset))
  const res = await fetchWithRetry(`${BROWSE_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
  })
  if (!res || res.status !== 200) {
    if (res && res.status === 401) cachedToken = null
    const err = new Error(`search ${res ? res.status : 'network'}`)
    err.status = res?.status
    throw err
  }
  const data = await res.json().catch(() => null)
  if (!data) throw new Error('search malformed')
  return data.itemSummaries ?? []
}

function matchingPrices(items, ref, { otherRarities = true } = {}) {
  // The first pass also drops listings naming a longer rarity that contains the requested one.
  return items
    .filter(
      (i) =>
        titleMatches(i.title, ref) &&
        isSingleCard(i.title) &&
        matchesTone(i.title, ref.rarity) &&
        (otherRarities
          ? !namesLongerRarity(i.title, ref.rarity)
          : !namesOtherRarity(i.title, ref.rarity)) &&
        i.price?.currency === 'USD'
    )
    .map((i) => Number.parseFloat(i.price.value))
    .filter(Number.isFinite)
}

async function lookup(env, params) {
  let prices = matchingPrices(await search(env, buildQuery(params)), params)
  let rarityFallback = false
  if (prices.length < 2 && params.rarity) {
    // Without rarity in the query, drop listings that name a different rarity.
    const fallback = matchingPrices(
      await search(env, buildQuery({ ...params, rarity: '' })),
      params,
      { otherRarities: false }
    )
    if (fallback.length > prices.length) {
      prices = fallback
      rarityFallback = true
    }
  }
  return {
    ...askingPrice(prices),
    rarityFallback,
    currency: 'USD',
    checkedAt: new Date().toISOString()
  }
}

async function lookupSet(env, key, lang) {
  // Unquoted so eBay matches every number in the set; a bare "LOB-" has no region letters, so add the language word.
  const query = key.endsWith('-') ? `${key} ${EBAY_WORDS[lang]}` : key
  const items = []
  let calls = 0
  for (let page = 0; page < SET_MAX_PAGES; page++) {
    const got = await search(env, query, { offset: page * SET_PAGE, limit: SET_PAGE })
    calls++
    items.push(...got)
    if (got.length < SET_PAGE) break
  }
  return { ...setPrices(items, key), calls, checkedAt: new Date().toISOString() }
}

// Remaining Browse calls for the day; null fields on any failure.
async function lookupQuota(env) {
  try {
    const token = await getToken(env)
    const res = await fetchWithRetry(QUOTA_URL, { headers: { Authorization: `Bearer ${token}` } })
    if (!res || res.status !== 200) throw new Error('quota')
    const data = await res.json()
    const limit = data.rateLimits
      ?.flatMap((l) => l.resources ?? [])
      .find((r) => r.name === 'buy.browse')?.rates?.[0]
    const remaining = Number(limit?.remaining)
    if (limit?.remaining == null || !Number.isFinite(remaining)) throw new Error('quota')
    return { remaining, resetAt: limit.reset ?? null }
  } catch {
    return { remaining: null, resetAt: null }
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET') return respond({ error: 'method not allowed' }, 405)
    const url = new URL(request.url)
    const clientOk = CLIENTS.has(request.headers.get('X-Client'))
    if (url.pathname === '/v1/quota') {
      if (!clientOk) return respond({ error: 'bad request' }, 400)
      return respond(await lookupQuota(env))
    }
    if (url.pathname === '/v1/set') {
      const key = (url.searchParams.get('key') ?? '').trim().toUpperCase()
      const lang = url.searchParams.get('lang') ?? ''
      if (!clientOk || !SET_LANGS.has(lang) || !key || key.length > MAX_FIELD) {
        return respond({ error: 'bad request' }, 400)
      }
      try {
        return respond(await lookupSet(env, key, lang))
      } catch (e) {
        if (e?.status === 429) return respond({ error: 'rate limited' }, 429)
        console.error(
          'ebay set failed',
          String(e?.message ?? '')
            .split(' ')
            .slice(0, 2)
            .join(' ')
        )
        return respond({ error: 'upstream' }, 502)
      }
    }
    if (url.pathname !== '/v1/price') return respond({ error: 'not found' }, 404)

    const q = url.searchParams
    const params = {
      code: (q.get('code') ?? '').trim().toUpperCase(),
      name: (q.get('name') ?? '').trim(),
      set: (q.get('set') ?? '').trim(),
      rarity: (q.get('rarity') ?? '').trim(),
      lang: q.get('lang') ?? ''
    }
    if (
      !CLIENTS.has(request.headers.get('X-Client')) ||
      !Object.hasOwn(EBAY_WORDS, params.lang) ||
      !params.name ||
      [params.code, params.name, params.set, params.rarity].some((v) => v.length > MAX_FIELD)
    ) {
      return respond({ error: 'bad request' }, 400)
    }

    const key = await cacheKey(params)
    let hit = null
    try {
      hit = await env.PRICES.get(key)
    } catch {
      // KV read failure is a cache miss.
    }
    if (hit) return new Response(hit, { headers: { 'content-type': 'application/json' } })

    try {
      const body = JSON.stringify(await lookup(env, params))
      // Best-effort: a KV write failure must not fail a good result.
      let write
      try {
        write = Promise.resolve(env.PRICES.put(key, body, { expirationTtl: CACHE_TTL }))
      } catch {
        write = Promise.resolve()
      }
      write = write.catch(() => {})
      if (ctx?.waitUntil) ctx.waitUntil(write)
      else await write
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
