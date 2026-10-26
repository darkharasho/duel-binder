import type { ImageSource, ImageSources } from './cache'

/** Every image through the portal's /img routes, authorized by the desktop token. */
export function portalImageSources(opts: {
  portal: string
  token: () => string | null
  /** The server's id for a local printing; null when the catalog feed hasn't given it one. */
  remoteId: (printingId: number) => number | null
}): ImageSources {
  const base = opts.portal.replace(/\/+$/, '')
  const at = (route: string): ImageSource | null => {
    const token = opts.token()
    return token
      ? { url: `${base}/img/${route}`, headers: { authorization: `Bearer ${token}` } }
      : null
  }
  return {
    card: (size, id) => at(`${size}/${id}`),
    set: (key) => at(`set/${encodeURIComponent(key)}`),
    konami: (key) => at(`konami/${encodeURIComponent(key)}`),
    printing: async (printingId) => {
      const remote = opts.remoteId(printingId)
      const source = remote === null ? null : at(`printing/${remote}`)
      return source && { ...source, key: `srv-${remote}` }
    }
  }
}
