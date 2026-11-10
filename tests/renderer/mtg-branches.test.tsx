import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GAMES, MTG_ID_MIN, mtgCardId } from '@shared/games'
import { MTG_RARITIES } from '@shared/games/magic'
import { chaseTier } from '@shared/chaseRarity'
import { setType } from '@shared/setTypes'
import type { BinderCard, CardRow } from '@shared/types'
import { rarityColor } from '@/lib/rarityColors'
import { facetsFor } from '@/lib/filters'
import { rangeFilters } from '@/lib/rangeFilters'
import { CardPlaceholder } from '@/components/CardPlaceholder'
import { CardArt } from '@/components/CardArt'
import { CardDetails } from '@/components/CardDetails'
import { GameProvider } from '@/lib/game'
import { sortBinderCards } from '@/features/binders/binderSort'
import { resetPrintingPhotos } from '@/lib/printingPhotos'
import { createMockApi, renderWithProviders } from './mockApi'

const GREY = '#9ca3af'

describe('rarityColor on Magic', () => {
  it('gives Magic rarities, foils included, their own colours', () => {
    expect(rarityColor('Mythic', 'mtg')).not.toBe(GREY)
    expect(rarityColor('Rare (Foil)', 'mtg')).not.toBe(GREY)
    for (const r of MTG_RARITIES) expect(rarityColor(r, 'mtg')).not.toBe(GREY)
  })
})

describe('CardPlaceholder on Magic', () => {
  it("draws the Magic placeholder for game 'mtg'", () => {
    render(<CardPlaceholder game="mtg" label="Serra Angel" aspect={{ width: 488, height: 680 }} />)
    expect(screen.getByTestId('card-art-placeholder')).toHaveAttribute('data-game', 'mtg')
  })
})

describe('CardArt printing photos on Magic', () => {
  beforeEach(() => resetPrintingPhotos())
  it('requests no printing photo for a Magic image id', () => {
    render(<CardArt imageId={MTG_ID_MIN + 7} printingId={9} size="small" alt="Serra Angel" />)
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
  })
})

describe('chaseTier on Magic', () => {
  it('takes Mythic and Special/Bonus for chases, by its own words', () => {
    expect(chaseTier('mtg', 'Mythic')).toBeGreaterThan(0)
    expect(chaseTier('mtg', 'Mythic (Foil)')).toBeGreaterThan(0)
    expect(chaseTier('mtg', 'Special')).toBe(2)
    expect(chaseTier('mtg', 'Bonus')).toBe(2)
    expect(chaseTier('mtg', 'Common')).toBe(0)
    expect(chaseTier('mtg', 'Rare')).toBe(0)
    // A Yu-Gi-Oh word means nothing on Magic.
    expect(chaseTier('mtg', 'Secret Rare')).toBe(0)
    expect(chaseTier('ygo', 'Secret Rare')).toBe(1)
  })
})

describe('setType on Magic', () => {
  it('is a booster for every set in step 1, never a Yu-Gi-Oh name rule', () => {
    expect(setType({ setName: 'Commander Legends Structure Deck', setCode: 'CMR' }, 'mtg')).toBe(
      'booster'
    )
  })
})

describe('filters on Magic', () => {
  it('shows the Rarity filter', () => {
    expect(facetsFor(GAMES.mtg).map((f) => f.key)).toContain('rarities')
    expect(facetsFor(GAMES.op).map((f) => f.key)).not.toContain('rarities')
  })
})

describe('the Magic filter panel', () => {
  it('lists its own facets and ranges, and no Set type', () => {
    expect(facetsFor(GAMES.mtg).map((f) => f.label)).toEqual([
      'Color',
      'Type',
      'Finish',
      'Set',
      'Rarity'
    ])
    expect(rangeFilters(GAMES.mtg.filters).map((f) => f.label)).toEqual([
      'Mana value',
      'Power',
      'Toughness'
    ])
    expect(GAMES.mtg.filters.map((f) => f.label)).not.toContain('Set type')
  })
})

describe('binder type sort on Magic', () => {
  const slot = (name: string, frameType: string): BinderCard =>
    ({
      key: `card:${name}`,
      level: 'card',
      card: { id: 1, name, type: 'Creature', frameType } as CardRow,
      imageId: 7,
      printing: null,
      printingScan: false,
      releaseDate: null,
      owned: 0,
      added: false,
      price: null
    }) as BinderCard
  it('never orders Magic cards by Yu-Gi-Oh frames', () => {
    // On Yu-Gi-Oh 'normal' goes before 'effect'; Magic has no type order yet, so names decide.
    const cards = [slot('Zulu', 'normal'), slot('Alpha', 'effect')]
    expect(
      sortBinderCards(cards, { by: 'type', dir: 'asc' }, 'mtg').map((c) => c.card.name)
    ).toEqual(['Alpha', 'Zulu'])
    expect(
      sortBinderCards(cards, { by: 'type', dir: 'asc' }, 'ygo').map((c) => c.card.name)
    ).toEqual(['Zulu', 'Alpha'])
  })
})

describe('CardDetails on Magic', () => {
  it("lists a Magic card's own facts and its printing", async () => {
    const card = {
      id: mtgCardId('en', 'oracle-1'),
      name: 'Serra Angel',
      type: 'Creature',
      frameType: 'mtg',
      race: '',
      attribute: null,
      level: null,
      linkval: null,
      atk: null,
      def: null,
      archetype: null,
      desc: '',
      tcgplayerPrice: null,
      magic: {
        typeLine: 'Creature — Angel',
        types: ['Creature'],
        manaCost: '{3}{W}{W}',
        manaValue: 5,
        colors: ['W'],
        oracleText: 'Flying, vigilance',
        power: '4',
        toughness: '4',
        loyalty: null,
        defense: null,
        artist: 'Greg Staples'
      }
    } as unknown as CardRow
    renderWithProviders(
      <GameProvider>
        <CardDetails card={card} printing={{ setCode: 'M15 33', setRarity: 'Rare' }} />
      </GameProvider>,
      {
        api: createMockApi({
          games: { available: async () => ['ygo', 'mtg'], active: async () => 'mtg' }
        })
      }
    )
    const fact = async (label: string, value: string): Promise<void> => {
      expect((await screen.findByText(label)).nextElementSibling).toHaveTextContent(value)
    }
    await fact('Type', 'Creature — Angel')
    await fact('Mana cost', '{3}{W}{W}')
    await fact('Power', '4')
    await fact('Rarity', 'Rare')
    await fact('Artist', 'Greg Staples')
    await fact('Set & number', 'M15 33')
    expect(screen.getAllByText('Set & number')).toHaveLength(1)
  })
})
