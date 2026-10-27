import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { parseImageUrl, parsePrintingImageUrl, parseSetImageUrl, type ImageCache } from './cache'

const SCHEME = 'ygo-img'

/** Must be called before `app.whenReady()`. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

export function handleImageProtocol(cache: ImageCache): void {
  protocol.handle(SCHEME, async (request) => {
    const printingId = parsePrintingImageUrl(request.url)
    if (printingId !== null) {
      const file = await cache.getPrinting(printingId)
      return file
        ? net.fetch(pathToFileURL(file).toString())
        : new Response('Not found', { status: 404 })
    }
    const parsed = parseImageUrl(request.url)
    const setKey = parsed ? null : parseSetImageUrl(request.url)
    if (!parsed && !setKey) return new Response('Not found', { status: 404 })
    // `?now`: someone's waiting on this one (Rip's next pack), so it goes ahead of the queue.
    const priority = new URL(request.url).searchParams.has('now')
    const file = parsed
      ? await cache.get(parsed.size, parsed.id, { priority })
      : await cache.getSet(setKey!, { priority })
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
