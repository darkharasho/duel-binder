/** The deployed eBay price Worker. */
export const PRICE_WORKER_URL = 'https://ygo-ebay-prices.project96.workers.dev'

/** Env var override first (dev/testing), else the built-in URL; an empty override turns prices off (null). */
export function priceWorkerUrl(): string | null {
  const url = (process.env['YGO_PRICE_WORKER_URL'] ?? PRICE_WORKER_URL).trim()
  return url === '' ? null : url
}
