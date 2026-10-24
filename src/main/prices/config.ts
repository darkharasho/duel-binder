/** The deployed eBay price Worker, used until the user saves another address in Settings. */
export const PRICE_WORKER_URL = 'https://ygo-ebay-prices.project96.workers.dev'

/**
 * The env var override first (dev/testing), then the address saved in Settings, then the built-in URL.
 * An empty value at any level turns prices off (null).
 */
export function priceWorkerUrl(saved: string | null = null): string | null {
  const url = (process.env['YGO_PRICE_WORKER_URL'] ?? saved ?? PRICE_WORKER_URL).trim()
  return url === '' ? null : url
}

/** Normalises an address typed in Settings: '' stays '' (prices off); anything else must be http(s). */
export function normalizeWorkerUrl(input: string): string {
  const url = input.trim()
  if (url === '') return ''
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Enter a full address, like https://example.workers.dev')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new Error('The address must start with https://')
  return url.replace(/\/+$/, '')
}
