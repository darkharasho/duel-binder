import { describe, expect, it } from 'vitest'
import { SNAPSHOT_BUILDER, snapshotUpToDate } from '../../scripts/catalog/snapshots'

describe('snapshotUpToDate', () => {
  it('is a short hex hash of the export code', () => {
    expect(SNAPSHOT_BUILDER).toMatch(/^[0-9a-f]{12}$/)
  })

  it('skips only when both the cursor and the export code match', () => {
    const same = { cursor: 7, builder: SNAPSHOT_BUILDER }
    expect(snapshotUpToDate(same, 7)).toBe(true)
    expect(snapshotUpToDate(same, 8)).toBe(false)
    expect(snapshotUpToDate({ cursor: 7, builder: 'aaaaaaaaaaaa' }, 7)).toBe(false)
    // Built before the export code was recorded.
    expect(snapshotUpToDate({ cursor: 7 }, 7)).toBe(false)
    expect(snapshotUpToDate(null, 7)).toBe(false)
  })
})
