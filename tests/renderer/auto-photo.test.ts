import { describe, expect, it } from 'vitest'
import { AUTO_PHOTO_MS, AUTO_PHOTO_TRIES } from '@shared/scan/thresholds'
import { autoPhotoDue } from '@/features/scan/useScanLoop'

describe('autoPhotoDue', () => {
  it('waits for a card to stay undecided', () => {
    expect(autoPhotoDue(1000, 0, 1000 + AUTO_PHOTO_MS - 1)).toBe(false)
    expect(autoPhotoDue(1000, 0, 1000 + AUTO_PHOTO_MS)).toBe(true)
  })

  it('stops after its tries', () => {
    expect(autoPhotoDue(0, AUTO_PHOTO_TRIES - 1, AUTO_PHOTO_MS)).toBe(true)
    expect(autoPhotoDue(0, AUTO_PHOTO_TRIES, AUTO_PHOTO_MS)).toBe(false)
  })
})
