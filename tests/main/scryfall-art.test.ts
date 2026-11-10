import { describe, expect, it } from 'vitest'
import { scryfallArtUrl } from '../../src/shared/imageSources'

const ID = '77c6fa74-5543-42ac-9ead-0e890b188e99'

describe('scryfallArtUrl', () => {
  it('names the normal and large front images', () => {
    expect(scryfallArtUrl(ID, 'small')).toBe(`https://cards.scryfall.io/normal/front/7/7/${ID}.jpg`)
    expect(scryfallArtUrl(ID, 'full')).toBe(`https://cards.scryfall.io/large/front/7/7/${ID}.jpg`)
  })
  it('names the back face when asked', () => {
    expect(scryfallArtUrl(ID, 'small', 'back')).toBe(
      `https://cards.scryfall.io/normal/back/7/7/${ID}.jpg`
    )
    expect(scryfallArtUrl(ID, 'full', 'back')).toBe(
      `https://cards.scryfall.io/large/back/7/7/${ID}.jpg`
    )
  })
  it('lowercases an uppercase id', () => {
    expect(scryfallArtUrl(ID.toUpperCase(), 'small')).toBe(
      `https://cards.scryfall.io/normal/front/7/7/${ID}.jpg`
    )
  })
  it('refuses anything that is not a uuid', () => {
    expect(scryfallArtUrl('../x', 'small')).toBeNull()
    expect(scryfallArtUrl('', 'full')).toBeNull()
  })
})
