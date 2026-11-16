import type { EdgeCache } from '../images'

/**
 * The /support thanks list, kept at the edge for as long as the store's answer says (5 minutes),
 * so site views don't each wake the main Durable Object. A failing store lists nobody.
 */
export async function cachedSupporterNames(
  cache: EdgeCache,
  url: string,
  load: () => Promise<Response>
): Promise<string[]> {
  const key = new Request(url)
  let res = await cache.match(key)
  if (!res) {
    res = await load()
    if (!res.ok) return []
    await cache.put(key, res.clone())
  }
  const body = (await res.json()) as { names?: unknown }
  return Array.isArray(body.names) ? body.names.filter((n) => typeof n === 'string') : []
}
