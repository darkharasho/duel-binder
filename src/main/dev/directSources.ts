import type { SqlDb } from '../db/sql'
import {
  imageUrl,
  KONAMI_LOGO_PREFIX,
  PACK_ART_PREFIX,
  setImageUrl,
  YUGIPEDIA_IMAGE_PREFIX
} from '../../shared/imageSources'
import type { ImageSources } from '../images/cache'
import { printingImageKey } from '../images/cache'
import { findSetImageUrl } from '../repo/sets'

const REPO_URL = 'https://github.com/darkharasho/duel-binder'

/**
 * Today's direct-to-source image URLs (YGOPRODeck, Yugipedia, TCGplayer, Konami). Dev fake-data
 * profile only; packaged builds go through the portal.
 */
export function directImageSources(opts: {
  db: SqlDb
  version: string
  /** Finds the photo URL of a printing, Yugipedia or TCGplayer (null when none). */
  resolvePrintingArt?: (printingId: number) => Promise<string | null>
}): ImageSources {
  const headers = { 'User-Agent': `DuelBinder/${opts.version} (${REPO_URL})` }
  const resolved = (
    key: string,
    prefix: string
  ): { url: string; headers: typeof headers } | null => {
    const url = findSetImageUrl(opts.db, key)
    return url !== null && url.startsWith(prefix) ? { url, headers } : null
  }
  return {
    card: (size, id) => ({ url: imageUrl(size, id) }),
    set(key) {
      const source = key.slice(0, 3)
      if (source === 'yp-') return resolved(key, YUGIPEDIA_IMAGE_PREFIX)
      if (source === 'yc-') return resolved(key, PACK_ART_PREFIX)
      return { url: setImageUrl(key) }
    },
    konami: (key) => resolved(key, KONAMI_LOGO_PREFIX),
    async printing(printingId) {
      const url = (await opts.resolvePrintingArt?.(printingId)) ?? null
      const key = printingImageKey(url)
      return url !== null && key !== null ? { url, headers, key } : null
    }
  }
}
