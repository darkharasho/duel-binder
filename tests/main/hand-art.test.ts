import { describe, expect, it } from 'vitest'
import { handArtUrl } from '../../scripts/catalog/pokemon/art'
import { HAND_ART_PREFIX } from '../../src/shared/imageSources'

describe('owner-supplied card art', () => {
  it('covers every card of the set and nothing else', () => {
    expect(handArtUrl('en/me06-001')).toBe(`${HAND_ART_PREFIX}en-me06-001`)
    expect(handArtUrl('en/me06-141')).toBe(`${HAND_ART_PREFIX}en-me06-141`)
    expect(handArtUrl('en/me06-142')).toBeNull()
    expect(handArtUrl('en/me05-001')).toBeNull()
    expect(handArtUrl('ja/me06-001')).toBeNull()
  })
})
