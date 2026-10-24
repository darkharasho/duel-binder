import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { parseImageUrl, parseSetImageUrl, type ImageCache } from './cache'

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
    const setKey = parsed ? null : parseSetImageUrl(request.url)
    if (!parsed && !setKey) return new Response('Not found', { status: 404 })
    const file = parsed ? await cache.get(parsed.size, parsed.id) : await cache.getSet(setKey!)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
