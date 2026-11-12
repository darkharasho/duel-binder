import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onePieceCardId, onePieceImageId } from '@shared/games'
import type { Api } from '@shared/ipc'
import type { BrowseFacets, CardDetail, CardRow, CardSearchResult, Printing } from '@shared/types'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { CardSheet } from '@/components/CardSheet'
import { CardDetails } from '@/components/CardDetails'
import { CardPanel } from '@/features/card/CardPanel'
import { GameProvider } from '@/lib/game'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const NUMBER = 'OP01-001'
const CARD_ID = onePieceCardId('en', NUMBER)
const BASE_ART = onePieceImageId('en', NUMBER)
const ALT_ART = onePieceImageId('en', `${NUMBER}_p1`)
const EFFECT = '[Activate: Main] Give 1 Rested DON!!'

const card: CardRow = {
  id: CARD_ID,
  name: 'Monkey.D.Luffy',
  type: 'Leader',
  frameType: 'op',
  race: '',
  attribute: null,
  level: null,
  linkval: null,
  atk: null,
  def: null,
  archetype: null,
  desc: EFFECT,
  tcgplayerPrice: null,
  onePiece: {
    cardType: 'Leader',
    colors: ['Red'],
    cost: null,
    life: 5,
    power: 5000,
    counter: null,
    attribute: ['Strike'],
    traits: ['Straw Hat Crew'],
    blockIcon: null,
    number: NUMBER
  }
}

const printing = (
  id: number,
  rarity: string,
  code: string,
  artImageId: number,
  price: number
): Printing => ({
  id,
  cardId: CARD_ID,
  setName: 'ROMANCE DAWN [OP-01]',
  setCode: NUMBER,
  setRarity: rarity,
  setRarityCode: code,
  setPrice: price,
  missingFromApi: false,
  language: 'en',
  artImageId
})

const base = printing(1, 'L', NUMBER, BASE_ART, 1)
const alt = printing(2, 'L (Alternate Art)', `${NUMBER}_p1`, ALT_ART, 40)
const detail: CardDetail = {
  card,
  printings: [base, alt],
  images: [
    { imageId: BASE_ART, cardId: CARD_ID, sortOrder: 0 },
    { imageId: ALT_ART, cardId: CARD_ID, sortOrder: 1 }
  ]
}
const result: CardSearchResult = {
  id: CARD_ID,
  name: card.name,
  type: card.type,
  defaultImageId: BASE_ART,
  matchedSetCode: null
}

const opApi = (o: DeepPartial<Api> = {}): Api =>
  createMockApi({
    ...o,
    cards: { search: async () => [result], get: async () => detail, ...o.cards },
    games: { available: async () => ['ygo', 'op'], active: async () => 'op' }
  })

describe('One Piece versions in the UI', () => {
  it('AddCardDialog adds the Alternate Art with its own art', async () => {
    const add = vi.fn(async () => ({}) as never)
    renderWithProviders(
      <GameProvider>
        <AddCardDialog open onOpenChange={() => {}} />
      </GameProvider>,
      { api: opApi({ collection: { add } }) }
    )
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'luffy')
    await userEvent.click(await screen.findByText('Monkey.D.Luffy'))
    await userEvent.click(await screen.findByRole('option', { name: /L \(Alternate Art\)/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ printingId: alt.id, imageId: ALT_ART, quantity: 1 })
    )
  })

  it("CardDetails lists a One Piece card's facts and its effect once", async () => {
    renderWithProviders(
      <GameProvider>
        <CardDetails card={card} printing={alt} />
      </GameProvider>,
      { api: opApi() }
    )
    const fact = async (label: string, value: string): Promise<void> => {
      expect((await screen.findByText(label)).nextElementSibling).toHaveTextContent(value)
    }
    await fact('Card type', 'Leader')
    await fact('Color', 'Red')
    await fact('Life', '5')
    await fact('Traits', 'Straw Hat Crew')
    expect(screen.queryByText('Block')).not.toBeInTheDocument()
    expect(screen.getAllByText('Card number')).toHaveLength(1)
    expect(screen.getAllByText(EFFECT)).toHaveLength(1)
  })

  it('CardPanel shows the selected Alternate Art with its own art', async () => {
    renderWithProviders(
      <GameProvider>
        <CardSheet onClose={() => {}}>
          <CardPanel cardId={CARD_ID} onClose={() => {}} />
        </CardSheet>
      </GameProvider>,
      { api: opApi() }
    )
    const section = await screen.findByRole('region', { name: /Versions|Printings/ })
    await userEvent.click(
      await within(section).findByRole('button', { name: /^Monkey\.D\.Luffy .*Alternate Art/ })
    )
    await waitFor(() =>
      expect(screen.getByAltText('Monkey.D.Luffy').getAttribute('src')).toMatch(
        new RegExp(`/${ALT_ART}(\\?|$)`)
      )
    )
  })

  it('BrowsePage builds its One Piece filters and sorts', async () => {
    const facets: BrowseFacets = {
      cardTypes: [],
      attributes: [],
      races: [],
      archetypes: [],
      setNames: [],
      rarities: [],
      languages: ['en'],
      opColors: ['Red'],
      opCardTypes: ['Leader'],
      opAttributes: ['Strike'],
      opTraits: ['Straw Hat Crew'],
      opRarities: ['SR'],
      opVersions: ['Alternate Art'],
      opBlocks: ['5']
    }
    renderWithProviders(
      <GameProvider>
        <BrowsePage onAddCard={() => {}} />
      </GameProvider>,
      { api: opApi({ cards: { browseFacets: async () => facets } }) }
    )
    await userEvent.click(await screen.findByRole('combobox', { name: 'Sort by' }))
    expect(await screen.findByRole('option', { name: 'Cost: low to high' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /ATK/ })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    for (const [section, option] of [
      ['Color', 'Red'],
      ['Card type', 'Leader'],
      ['Attribute', 'Strike'],
      ['Trait', 'Straw Hat Crew'],
      ['Rarity', 'SR'],
      ['Version', 'Alternate Art'],
      ['Block', '5']
    ]) {
      expect(await screen.findByRole('button', { name: section })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: option })).toBeInTheDocument()
    }
    // One Rarity section: the rarity codes, not a second one of printing labels.
    expect(screen.getAllByRole('button', { name: 'Rarity' })).toHaveLength(1)
    for (const range of ['Cost', 'Power', 'Counter'])
      expect(screen.getByRole('button', { name: range })).toBeInTheDocument()
  })
})
