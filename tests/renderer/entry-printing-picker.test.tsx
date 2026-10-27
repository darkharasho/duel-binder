import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { CardDetail, EntryView, Printing } from '@shared/types'
import { CardSheet } from '@/components/CardSheet'
import { EntryDetailPanel } from '@/features/collection/EntryDetailPanel'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const printing = (id: number, extra: Partial<Printing> = {}): Printing => ({
  id,
  cardId: 1,
  setName: 'Legend of Blue Eyes',
  setCode: `LOB-EN00${id}`,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: 10,
  missingFromApi: false,
  ...extra
})

const card: CardDetail['card'] = {
  id: 1,
  name: 'Dark Magician',
  type: 'Normal Monster',
  frameType: 'normal',
  race: 'Spellcaster',
  attribute: 'DARK',
  level: 7,
  linkval: null,
  atk: 2500,
  def: 2100,
  archetype: null,
  desc: 'x',
  tcgplayerPrice: 1
}

const entry = (p: Printing): EntryView =>
  ({
    id: 5,
    quantity: 1,
    notes: '',
    createdAt: '',
    updatedAt: '',
    card,
    printing: p,
    imageId: 1,
    originalArt: true,
    unitPrice: 10,
    priceApproximate: false,
    priceSource: 'ygoprodeck',
    priceCheckedAt: null,
    priceListingCount: null,
    noPriceReason: null,
    totalValue: 10
  }) as EntryView

describe('entry editor printing picker', () => {
  it("shows the entry's own contributed printing, which the card's printings leave out", async () => {
    // The card detail lists only non-contributed printings; the entry is on a contributed one.
    const contributed = printing(9, { setCode: 'DESK-EN001', setName: 'Desktop Only Set' })
    renderWithProviders(
      <CardSheet onClose={() => {}}>
        <EntryDetailPanel cardId={1} entryId={5} onSelectEntry={() => {}} onClose={() => {}} />
      </CardSheet>,
      {
        api: createMockApi({
          cards: {
            get: async () => ({ card, printings: [printing(1), printing(2)], images: [{ imageId: 1, cardId: 1, sortOrder: 0 }] })
          },
          collection: { forCard: async () => [entry(contributed)] }
        })
      }
    )
    const picker = await screen.findByRole('combobox', { name: 'Printing' })
    expect(within(picker).getByText(/DESK-EN001/)).toBeInTheDocument()
  })
})
