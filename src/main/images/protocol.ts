import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import {
  parseImageUrl,
  parsePrintingImageUrl,
  parseSetImageUrl,
  parseSmallPrintingImageUrl,
  parseSpriteImageUrl,
  type ImageCache
} from './cache'

const SCHEME = 'ygo-img'

/** Must be called before `app.whenReady()`. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/** A served image with CORS open, so a canvas can read it (the wash samples card art). */
async function served(file: string): Promise<Response> {
  const res = await net.fetch(pathToFileURL(file).toString())
  const out = new Response(res.body, res)
  out.headers.set('access-control-allow-origin', '*')
  return out
}

export function handleImageProtocol(cache: ImageCache): void {
  protocol.handle(SCHEME, async (request) => {
    const smallId = parseSmallPrintingImageUrl(request.url)
    const printingId = smallId ?? parsePrintingImageUrl(request.url)
    if (printingId !== null) {
      const file = await cache.getPrinting(printingId, { small: smallId !== null })
      return file
        ? served(file)
        : new Response('Not found', { status: 404 })
    }
    const spriteN = parseSpriteImageUrl(request.url)
    if (spriteN !== null) {
      const file = await cache.getSprite(spriteN)
      return file
        ? served(file)
        : new Response('Not found', { status: 404 })
    }
    const parsed = parseImageUrl(request.url)
    const setKey = parsed ? null : parseSetImageUrl(request.url)
    if (!parsed && !setKey) return new Response('Not found', { status: 404 })
    // `?now`: someone's waiting on this one so it goes ahead of the queue.
    const priority = new URL(request.url).searchParams.has('now')
    const file = parsed
      ? await cache.get(parsed.size, parsed.id, { priority })
      : await cache.getSet(setKey!, { priority })
    if (!file) return new Response('Not found', { status: 404 })
    return served(file)
  })
}
