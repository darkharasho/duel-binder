import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardDetail, CardRow, CardSearchResult, Printing } from '@shared/types'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const card: CardRow = {
  id: 100,
  name: 'Charizard',
  type: 'Pokémon',
  frameType: 'normal',
  race: '',
  attribute: null,
  level: null,
  linkval: null,
  atk: null,
  def: null,
  archetype: null,
  desc: '',
  tcgplayerPrice: 1
}
const printing = (id: number, setName: string, setCode: string): Printing => ({
  id,
  cardId: card.id,
  setName,
  setCode,
  setRarity: 'Rare',
  setRarityCode: '(R)',
  language: 'en',
  setPrice: 5,
  missingFromApi: false
})
const detail: CardDetail = {
  card,
  printings: [
    printing(1, 'Base Set', 'BS 4/102'),
    printing(2, 'Lost Origin Trainer Gallery', 'LOR:TG TG03/30')
  ],
  images: [{ imageId: 100, cardId: card.id, sortOrder: 0 }]
}
const plain: CardSearchResult = {
  id: card.id,
  name: 'Charizard',
  type: 'Pokémon',
  defaultImageId: 100,
  matchedSetCode: null
}
const version: CardSearchResult = {
  ...plain,
  printingId: 2,
  setName: 'Lost Origin Trainer Gallery',
  setCode: 'LOR:TG TG03/30',
  imageId: 200
}

function setup(rows: CardSearchResult[]): void {
  const api = createMockApi({ cards: { search: async () => rows, get: async () => detail } })
  renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />, { api })
}

describe('AddCardDialog version rows', () => {
  beforeEach(() => localStorage.clear())

  it('shows the version row beside its card row and opens on that printing', async () => {
    setup([version, plain])
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'trainer gallery')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('Lost Origin Trainer Gallery · LOR:TG TG03/30')
    expect(options[1]).not.toHaveTextContent('Lost Origin')
    // The version row shows its printing's art (imageId 200); the card row the card's (100).
    expect(options[0].querySelector('img')?.getAttribute('src')).toMatch(/\b200\b/)
    expect(options[1].querySelector('img')?.getAttribute('src')).toMatch(/\b100\b/)
    await userEvent.click(options[0])
    const picked = await screen.findByRole('option', { selected: true })
    expect(picked).toHaveTextContent('Lost Origin Trainer Gallery')
  })

  it('says what a misspelt search was corrected to', async () => {
    setup([{ ...plain, nearMiss: 'charizard' }])
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'charizrd')
    expect(await screen.findByText('Showing results for “charizard”')).toBeInTheDocument()
  })
})
