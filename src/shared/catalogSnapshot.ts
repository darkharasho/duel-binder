import { CATALOG_TABLES } from './catalogTables'
import type { GameId } from './games'

/**
 * Prebuilt catalog snapshots: one compressed SQLite file per game in R2, which a device pulling
 * the game for the first time imports instead of reading the whole change feed. Yu-Gi-Oh! has
 * none (a fresh install's switch sets its cursor before any pull).
 */
export const SNAPSHOT_GAMES: readonly GameId[] = ['pkm', 'op', 'mtg']

/** The extra columns the feed sends for `card_printings` (see the portal's feedColumns). */
const PRINTING_FEED_EXTRAS = ['id', 'pkey', 'contributed']

/** FNV-1a, 32 bit, as 8 hex characters. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * A short hash of the catalog's tables and columns. A snapshot is only imported by an app with
 * the same shape: most migrations don't touch catalog columns, so snapshots built from main keep
 * serving released apps until a catalog column really changes.
 */
export function catalogShape(): string {
  return fnv1a(
    JSON.stringify([
      CATALOG_TABLES.map((t) => [t.name, t.key, t.columns, t.games]),
      PRINTING_FEED_EXTRAS
    ])
  )
}

const base = (game: GameId, shape: string): string => `catalog-snapshots/${game}/${shape}`

export const snapshotManifestKey = (game: GameId, shape: string): string =>
  `${base(game, shape)}/manifest.json`

export const snapshotFileKey = (game: GameId, shape: string, cursor: number): string =>
  `${base(game, shape)}/${cursor}.sqlite.gz`

/** What `catalog-snapshots/<game>/<shape>/manifest.json` holds. */
export interface SnapshotManifest {
  game: GameId
  shape: string
  /** The game's feed cursor the snapshot is current to. */
  cursor: number
  dbVersion: string | null
  /** The gzipped file's size and sha256 (hex). */
  bytes: number
  sha256: string
  builtAt: string
  /** The file's R2 key. */
  key: string
}

/** A manifest as the portal hands it to a device, with a signed download URL. */
export interface SnapshotOffer extends SnapshotManifest {
  url: string
}
