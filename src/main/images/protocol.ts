import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { parseImageUrl, type ImageCache } from './cache'

const SCHEME = 'ygo-img'

/** Must be called before `app.whenReady()`. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

export function handleImageProtocol(cache: ImageCache): void {
  protocol.handle(SCHEME, async (request) => {
    const parsed = parseImageUrl(request.url)
    if (!parsed) return new Response('Not found', { status: 404 })
    const file = await cache.get(parsed.size, parsed.id)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
