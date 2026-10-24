/** The deployed eBay price Worker. Empty until the Worker is deployed. */
export const PRICE_WORKER_URL = ''

/** Env var override first (dev/testing), else the built-in URL; null when neither is set. */
export function priceWorkerUrl(): string | null {
  const url = (process.env['YGO_PRICE_WORKER_URL'] ?? PRICE_WORKER_URL).trim()
  return url === '' ? null : url
}
