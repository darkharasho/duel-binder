import { describe, expect, it } from 'vitest'
import {
  catalogShape,
  SNAPSHOT_GAMES,
  snapshotFileKey,
  snapshotManifestKey
} from '../../src/shared/catalogSnapshot'

describe('catalog snapshot keys', () => {
  it('catalogShape is stable and 8 hex chars', () => {
    expect(catalogShape()).toMatch(/^[0-9a-f]{8}$/)
    expect(catalogShape()).toBe(catalogShape())
  })

  it('keys follow the R2 layout', () => {
    expect(snapshotFileKey('mtg', 'abcd1234', 42)).toBe('catalog-snapshots/mtg/abcd1234/42.sqlite.gz')
    expect(snapshotManifestKey('mtg', 'abcd1234')).toBe(
      'catalog-snapshots/mtg/abcd1234/manifest.json'
    )
  })

  it('snapshots cover Pokémon, One Piece and Magic only', () => {
    expect(SNAPSHOT_GAMES).toEqual(['pkm', 'op', 'mtg'])
  })
})
