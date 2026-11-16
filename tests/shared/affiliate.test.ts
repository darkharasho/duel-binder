import { describe, expect, it } from 'vitest'
import { buyLinks, ebayUrl, tcgplayerUrl, type BuyTarget } from '../../src/shared/affiliate'

const ids = { ebayCampaignId: '5338000000', tcgplayerImpactBase: 'https://tcgplayer.pxf.io/c/1/2/3' }
const target = (t: Partial<BuyTarget>): BuyTarget => ({
  game: 'ygo',
  name: 'Dark Magician',
  setCode: 'LOB-005',
  setRarity: 'Ultra Rare',
  language: 'en',
  ...t
})
const inner = (url: string | null): string => new URL(url!).searchParams.get('u')!
const query = (url: string | null): string => new URL(url!).searchParams.get('_nkw')!

describe('affiliate buy links', () => {
  it('exact product link when the printing has a TCGplayer id', () => {
    const t = target({ game: 'pkm', name: 'Pikachu', setCode: 'SV1-025', setRarity: 'Common', tcgProductId: 12345 })
    expect(tcgplayerUrl(t, ids)).toBe(
      'https://tcgplayer.pxf.io/c/1/2/3?u=' + encodeURIComponent('https://www.tcgplayer.com/product/12345')
    )
  })

  it('English printing without id searches TCGplayer by name and set code', () => {
    expect(inner(tcgplayerUrl(target({}), ids))).toBe(
      'https://www.tcgplayer.com/search/yugioh/product?q=Dark%20Magician%20LOB-005'
    )
    expect(inner(tcgplayerUrl(target({ game: 'op' }), ids))).toContain('/search/one-piece-card-game/')
    expect(inner(tcgplayerUrl(target({ game: 'mtg' }), ids))).toContain('/search/magic/')
  })

  it('non-English printing without id has no TCGplayer link', () => {
    expect(tcgplayerUrl(target({ language: 'ja' }), ids)).toBeNull()
    expect(tcgplayerUrl(target({ game: 'pkm', language: 'ja', tcgProductId: 9 }), ids)).not.toBeNull()
  })

  it('eBay query carries code, untoned rarity and the language word', () => {
    const url = ebayUrl(
      target({ name: 'Blue-Eyes', setCode: 'RV01-KR005', setRarity: 'Ultra Rare (Manga-Style, Color)', language: 'ko' }),
      ids
    )
    expect(query(url)).toBe('Blue-Eyes RV01-KR005 Ultra Rare Korean')
    expect(url).toContain('campid=5338000000')
    expect(url!.startsWith('https://www.ebay.com/sch/i.html?')).toBe(true)
  })

  it('eBay query with no set code is just the name', () => {
    expect(query(ebayUrl(target({ name: 'Pikachu', setCode: '', setRarity: '' }), ids))).toBe('Pikachu')
  })

  it('names with & " / and CJK survive the round trip', () => {
    const name = 'Dragon & "Fire"/炎'
    expect(query(ebayUrl(target({ name }), ids)).startsWith(name)).toBe(true)
    expect(new URL(inner(tcgplayerUrl(target({ name }), ids))).searchParams.get('q')).toBe(`${name} LOB-005`)
  })

  it('lists TCGplayer before eBay', () => {
    expect(buyLinks(target({}), ids).map((l) => [l.store, l.label])).toEqual([
      ['tcgplayer', 'Buy on TCGplayer'],
      ['ebay', 'Buy on eBay']
    ])
  })

  it('blank ids give no links', () => {
    expect(buyLinks(target({}), { ebayCampaignId: '', tcgplayerImpactBase: '' })).toEqual([])
  })
})
