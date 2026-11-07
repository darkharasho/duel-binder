import type { ImageSource, ImageSources } from './cache'

/** Every image through the portal's /img routes, authorized by the desktop token. */
export function portalImageSources(opts: {
  portal: string
  token: () => string | null
  /** The server's id for a local printing; null when the catalog feed hasn't given it one. */
  remoteId: (printingId: number) => number | null
  /** Added to a printing photo's file name (printingPhotoSuffix); none by default. */
  photoSuffix?: (printingId: number) => string
}): ImageSources {
  const base = opts.portal.replace(/\/+$/, '')
  const at = (route: string): ImageSource | null => {
    const token = opts.token()
    return token
      ? { url: `${base}/img/${route}`, headers: { authorization: `Bearer ${token}` } }
      : null
  }
  const photo = (printingId: number, route: string, query: string): ImageSource | null => {
    const remote = opts.remoteId(printingId)
    const source = remote === null ? null : at(`${route}/${remote}${query}`)
    return source && { ...source, key: `srv-${remote}${opts.photoSuffix?.(printingId) ?? ''}` }
  }
  return {
    card: (size, id) => at(`${size}/${id}`),
    set: (key) => at(`set/${encodeURIComponent(key)}`),
    // Sprites are public: the bearer goes along when there is one, but its absence is no reason to skip.
    sprite: (n) => {
      const token = opts.token()
      return {
        url: `${base}/img/sprite/${n}`,
        ...(token && { headers: { authorization: `Bearer ${token}` } })
      }
    },
    konami: (key) => at(`konami/${encodeURIComponent(key)}`),
    printing: async (printingId) => photo(printingId, 'printing', ''),
    // `?only`: a 404 when there's no small copy yet, not the full photo in its place.
    printingSmall: async (printingId) => photo(printingId, 'printing-small', '?only')
  }
}
