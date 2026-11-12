import { describe, expect, it } from 'vitest'
import { contributeGame } from '@/features/training/contributeContext'

describe('contributeGame', () => {
  it('opens the game shown when testers may contribute to it', () => {
    expect(contributeGame('mtg', ['ygo', 'pkm', 'op', 'mtg'])).toBe('mtg')
    expect(contributeGame('op', ['ygo', 'pkm', 'op', 'mtg'])).toBe('op')
  })
  it('else the first tester game', () => {
    expect(contributeGame('ygo', ['ygo', 'op', 'mtg'])).toBe('op')
  })
  it('none without a tester game', () => {
    expect(contributeGame('ygo', ['ygo'])).toBeUndefined()
  })
})
