import { describe, expect, it } from 'vitest'
import { buyLinks, ebayUrl, tcgplayerUrl, type BuyTarget } from '../../src/shared/affiliate'

const ids = {
  ebayCampaignId: '5338000000',
  tcgplayerImpactBase: 'https://tcgplayer.pxf.io/c/1/2/3'
}
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
    const t = target({
      game: 'pkm',
      name: 'Pikachu',
      setCode: 'SV1-025',
      setRarity: 'Common',
      tcgProductId: 12345
    })
    expect(tcgplayerUrl(t, ids)).toBe(
      'https://tcgplayer.pxf.io/c/1/2/3?u=' +
        encodeURIComponent('https://www.tcgplayer.com/product/12345')
    )
  })

  it('English printing without id searches TCGplayer by name and set code', () => {
    expect(inner(tcgplayerUrl(target({}), ids))).toBe(
      'https://www.tcgplayer.com/search/yugioh/product?q=Dark%20Magician%20LOB-005'
    )
    expect(inner(tcgplayerUrl(target({ game: 'op' }), ids))).toContain(
      '/search/one-piece-card-game/'
    )
    expect(inner(tcgplayerUrl(target({ game: 'mtg' }), ids))).toContain('/search/magic/')
  })

  it('non-English printing without id has no TCGplayer link', () => {
    expect(tcgplayerUrl(target({ language: 'ja' }), ids)).toBeNull()
    expect(
      tcgplayerUrl(target({ game: 'pkm', language: 'ja', tcgProductId: 9 }), ids)
    ).not.toBeNull()
  })

  it('Yu-Gi-Oh! eBay query is the set code alone', () => {
    const url = ebayUrl(
      target({
        name: 'Blue-Eyes',
        setCode: 'RV01-KR005',
        setRarity: 'Ultra Rare (Manga-Style, Color)',
        language: 'ko'
      }),
      ids
    )
    // Sellers title by code; it already carries the set and the language.
    expect(query(url)).toBe('RV01-KR005')
    expect(query(ebayUrl(target({ setCode: 'YA01-JP001', language: 'ja' }), ids))).toBe(
      'YA01-JP001'
    )
    expect(url).toContain('campid=5338000000')
    expect(url!.startsWith('https://www.ebay.com/sch/i.html?')).toBe(true)
  })

  it('eBay query keeps rarity words sellers use, per game', () => {
    const q = (t: Partial<BuyTarget>): string => query(ebayUrl(target(t), ids))
    // Pokémon: the "rarity" is a finish; only Reverse Holo and 1st Edition are seller words.
    expect(q({ game: 'pkm', name: 'Pikachu', setCode: 'SVE 008/24', setRarity: 'Normal' })).toBe(
      'Pikachu SVE 008/24'
    )
    expect(q({ game: 'pkm', name: 'Pikachu', setCode: 'SV1-025', setRarity: 'Holofoil' })).toBe(
      'Pikachu SV1-025'
    )
    expect(
      q({ game: 'pkm', name: 'Pikachu', setCode: 'SV1-025', setRarity: 'Reverse Holofoil' })
    ).toBe('Pikachu SV1-025 Reverse Holo')
    expect(
      q({ game: 'pkm', name: 'Charizard', setCode: 'BS-4', setRarity: '1st Edition Holofoil' })
    ).toBe('Charizard BS-4 1st Edition')
    // One Piece and Magic: codes like "SR (Alternate Art)" or "Rare (Foil)" stay out.
    expect(
      q({ game: 'op', name: 'Luffy', setCode: 'OP01-024', setRarity: 'SR (Alternate Art)' })
    ).toBe('Luffy OP01-024')
    expect(
      q({ game: 'mtg', name: 'Lightning Bolt', setCode: 'M10 146', setRarity: 'Rare (Foil)' })
    ).toBe('Lightning Bolt M10 146')
  })

  it('eBay query with no set code is just the name', () => {
    expect(query(ebayUrl(target({ name: 'Pikachu', setCode: '', setRarity: '' }), ids))).toBe(
      'Pikachu'
    )
  })

  it('Yu-Gi-Oh! with no set code falls back to name, rarity and language', () => {
    expect(
      query(
        ebayUrl(
          target({ setCode: '', setRarity: 'Ultra Rare (Manga-Style, Color)', language: 'ko' }),
          ids
        )
      )
    ).toBe('Dark Magician Ultra Rare Korean')
  })

  it('names with & " / and CJK survive the round trip', () => {
    const name = 'Dragon & "Fire"/炎'
    expect(query(ebayUrl(target({ game: 'pkm', name }), ids)).startsWith(name)).toBe(true)
    expect(new URL(inner(tcgplayerUrl(target({ name }), ids))).searchParams.get('q')).toBe(
      `${name} LOB-005`
    )
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
