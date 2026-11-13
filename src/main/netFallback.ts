type Fetch = typeof fetch

/** A fetch that can say whether it has switched to the browser's network stack. */
export type FallbackFetch = Fetch & { usingChromium(): boolean }

/**
 * Node's fetch ignores the Windows certificate store and the system proxy. On a PC whose
 * antivirus scans HTTPS (with its own root certificate) or that needs a proxy, every request the
 * app makes fails while the browser works fine. When Node's fetch fails at the network level,
 * this retries through Chromium's stack (Electron's `net.fetch`), which uses the system's
 * certificates and proxy, and keeps using Chromium for the rest of the session.
 *
 * Aborted requests and requests whose body can't be sent twice (streams) are never retried.
 */
export function withChromiumFallback(
  nodeFetch: Fetch,
  chromiumFetch: Fetch,
  onSwitch?: (error: unknown) => void
): FallbackFetch {
  let chromium = false
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (chromium) return chromiumFetch(input, init)
    try {
      return await nodeFetch(input, init)
    } catch (e) {
      if (!retryable(e, input, init)) throw e
      const res = await chromiumFetch(input, init)
      if (!chromium) {
        chromium = true
        onSwitch?.(e)
      }
      return res
    }
  }) as FallbackFetch
  wrapped.usingChromium = () => chromium
  return wrapped
}

function retryable(e: unknown, input: RequestInfo | URL, init?: RequestInit): boolean {
  if (init?.signal?.aborted) return false
  if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return false
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!/^https?:/i.test(url)) return false
  if (typeof Request !== 'undefined' && input instanceof Request && input.body !== null)
    return false
  const body = init?.body
  if (body != null && typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
    return false
  return true
}
