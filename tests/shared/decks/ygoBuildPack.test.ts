import { describe, expect, it } from 'vitest'
import { parseRulesPack } from '../../../src/shared/decks/pack'
import { buildYgoPack, type YgoPackCard } from '../../../src/shared/decks/ygo/buildPack'
import sample from '../../fixtures/decks/ygo/cardinfo-sample.json'

const cards = sample.data as YgoPackCard[]
const builtAt = new Date('2026-11-22T03:00:00Z')

describe('buildYgoPack', () => {
  const pack = buildYgoPack(cards, builtAt)
  it('maps the banlists per region', () => {
    expect(pack.formats.advanced.limits['55144522']).toBe(0)
    expect(pack.formats.advanced.limits['33760966']).toBe(2)
    expect(pack.formats.advanced.limits['80181649']).toBe(1)
    expect(pack.formats.ocg.limits['1475311']).toBe(1)
    expect(pack.formats.advanced.limits['1475311']).toBeUndefined()
  })
  it('accepts the Banned wording as Forbidden', () => {
    const p = buildYgoPack(
      [
        {
          id: 1,
          banlist_info: { ban_tcg: 'Banned' },
          misc_info: [{ tcg_date: '2000-01-01', ocg_date: '2000-01-01' }]
        }
      ],
      builtAt
    )
    expect(p.formats.advanced.limits['1']).toBe(0)
  })
  it('lists cards not yet out in a region', () => {
    expect(pack.formats.advanced.notReleased['72978038']).toBeNull()
    expect(pack.formats.ocg.notReleased['72978038']).toBeUndefined()
    expect(pack.formats.advanced.notReleased['100461101']).toBe('2027-02-25')
    expect(pack.formats.ocg.notReleased['100461101']).toBe('2027-02-16')
  })
  it('leaves cards out in both regions in neither', () => {
    for (const f of [pack.formats.advanced, pack.formats.ocg]) {
      expect(f.notReleased['4731783']).toBeUndefined()
      expect(f.limits['4731783']).toBeUndefined()
    }
  })
  it('stamps the version and source', () => {
    expect(pack.version).toBe('2026-11-22')
    expect(pack.builtAt).toBe('2026-11-22T03:00:00.000Z')
    expect(pack.sources).toEqual([{ name: 'YGOPRODeck', fetchedAt: '2026-11-22T03:00:00.000Z' }])
  })
  it('is a ready pack and small', () => {
    expect(parseRulesPack(pack).state).toBe('ready')
    expect(JSON.stringify(pack).length).toBeLessThan(2000)
  })
})
