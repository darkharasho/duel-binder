import type Database from 'better-sqlite3'
import type { SqlDb } from '../db/sql'
import {
  BULBAGARDEN_IMAGE_PREFIX,
  TCGPLAYER_PACK_PREFIX,
  imageUrl,
  KONAMI_LOGO_PREFIX,
  isFallbackLogoUrl,
  PACK_ART_PREFIX,
  setImageUrl,
  YUGIPEDIA_IMAGE_PREFIX
} from '../../shared/imageSources'
import { PKM_ID_MIN } from '../../shared/games'
import type { ImageSources } from '../images/cache'
import { printingImageKey } from '../images/cache'
import { findPokemonSetArtUrl, findSetImageUrl } from '../repo/sets'
import type { CatalogService } from '../catalog/service'
import { createYgoClient } from '../ygo/client'
import { refreshCatalog, type RefreshCatalogDeps } from '../sync/catalog'
import { getSyncStatus } from '../sync/sync'
import { createYugipediaClient, type YugipediaClient } from '../yugipedia/client'
import { createPrintingArtResolver } from '../yugipedia/artResolver'
import { createTcgplayerLookup } from '../tcgplayer/catalog'

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
    prefix: string,
    find: (db: SqlDb, key: string) => string | null = findSetImageUrl
  ): { url: string; headers: typeof headers } | null => {
    const url = find(opts.db, key)
    return url !== null && url.startsWith(prefix) ? { url, headers } : null
  }
  return {
    card(size, id) {
      if (id < PKM_ID_MIN) return { url: imageUrl(size, id) }
      const row = opts.db
        .prepare(
          'SELECT pc.image_url FROM card_images ci JOIN pokemon_cards pc ON pc.card_id = ci.card_id WHERE ci.image_id = ?'
        )
        .get(id) as { image_url: string | null } | undefined
      if (!row?.image_url) return null
      const low = size !== 'full'
      return row.image_url.startsWith('https://assets.tcgdex.net/')
        ? { url: `${row.image_url}/${low ? 'low' : 'high'}.webp` }
        : { url: low ? row.image_url : row.image_url.replace(/_200w\.jpg$/, '_in_1000x1000.jpg') }
    },
    set(key) {
      const source = key.slice(0, 3)
      const tcgdexLogo = findSetImageUrl(opts.db, key)
      if (tcgdexLogo?.startsWith('https://assets.tcgdex.net/'))
        return { url: `${tcgdexLogo}.webp` }
      if (source === 'yp-') return resolved(key, YUGIPEDIA_IMAGE_PREFIX)
      if (source === 'yc-') return resolved(key, PACK_ART_PREFIX)
      if (source === 'bp-') return resolved(key, BULBAGARDEN_IMAGE_PREFIX, findPokemonSetArtUrl)
      if (source === 'tp-') return resolved(key, TCGPLAYER_PACK_PREFIX, findPokemonSetArtUrl)
      if (source === 'pt-') {
        const url = findPokemonSetArtUrl(opts.db, key)
        return url !== null && isFallbackLogoUrl(url) ? { url, headers } : null
      }
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

// Today's self-built catalog, straight from YGOPRODeck, Yugipedia, TCGplayer and Konami. Dev
// fake-data profile only; packaged builds get the catalog from the portal.

/** One Yugipedia client per process, so set syncs and art lookups share its request pacing. */
let yugipedia: YugipediaClient | null = null
const sharedYugipedia = (version: string): YugipediaClient =>
  (yugipedia ??= createYugipediaClient({ version }))

/** Finds a printing's photo URL, TCGplayer's first, then Yugipedia's (for `directImageSources`). */
export function directPrintingArt(
  db: Database.Database,
  version: string
): (printingId: number) => Promise<string | null> {
  const art = createPrintingArtResolver({
    db,
    client: sharedYugipedia(version),
    quickUrl: createTcgplayerLookup(db)
  })
  return (id) => art.url(id)
}

/** The self-built catalog's status; updates from the server's catalog never apply to it. */
export function directCatalog(db: Database.Database): CatalogService {
  return {
    status: () => getSyncStatus(db),
    update: async () => ({ changed: false, imagesChanged: false })
  }
}

/** Runs the self-built catalog refresh once (see `refreshCatalog`). */
export function startDirectCatalog(
  db: Database.Database,
  deps: Pick<RefreshCatalogDeps, 'version' | 'onSyncProgress' | 'onSynced' | 'onChanged'>
): Promise<{ changed: boolean }> {
  return refreshCatalog(db, {
    ...deps,
    client: createYgoClient(),
    yugipedia: sharedYugipedia(deps.version)
  })
}
