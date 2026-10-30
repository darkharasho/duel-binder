import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { BrowseCard, CardDetail, EntryView, Printing } from '@shared/types'
import { CardSheet } from '@/components/CardSheet'
import { BrowseCardPanel } from '@/features/browse/BrowseCardPanel'
import { SetCardPanel } from '@/features/sets/SetCardPanel'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist, PRINTING } from './setFixtures'

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

const detail = (printings: Printing[]): CardDetail => ({
  card: {
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
  },
  printings,
  images: [{ imageId: 1, cardId: 1, sortOrder: 0 }]
})

const entry = (p: Printing, extra: Partial<EntryView> = {}): EntryView =>
  ({
    id: 5,
    quantity: 1,
    notes: '',
    createdAt: '',
    updatedAt: '',
    card: detail([]).card,
    printing: p,
    imageId: 1,
    printingScan: true,
    unitPrice: 10,
    priceApproximate: false,
    priceSource: 'ygoprodeck',
    priceCheckedAt: null,
    priceListingCount: null,
    noPriceReason: null,
    totalValue: 10,
    ...extra
  }) as EntryView

const ebay: Partial<EntryView> = {
  unitPrice: 33.25,
  totalValue: 33.25,
  priceSource: 'ebay',
  priceListingCount: 7,
  priceCheckedAt: new Date(Date.now() - 3 * 86_400_000).toISOString()
}

const noPrice = (reason: EntryView['noPriceReason']): Partial<EntryView> => ({
  unitPrice: null,
  totalValue: 0,
  priceSource: 'ebay',
  noPriceReason: reason
})

const browseCard: BrowseCard = {
  id: 1,
  name: 'Dark Magician',
  type: 'Normal Monster',
  frameType: 'normal',
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 7,
  linkval: null,
  atk: 2500,
  def: 2100,
  imageId: 1,
  price: 7.5,
  releasedAt: '2002-03-08',
  owned: 0,
  defaultPrintingId: 10
}

function renderBrowse(printings: Printing[], entries: EntryView[]): void {
  renderWithProviders(
    <CardSheet onClose={() => {}}>
      <BrowseCardPanel card={browseCard} onMoreOptions={() => {}} />
    </CardSheet>,
    {
      api: createMockApi({
        cards: { get: async () => detail(printings) },
        collection: { forCard: async () => entries }
      })
    }
  )
}

const marketLine = async (): Promise<HTMLElement> => {
  const dialog = await screen.findByRole('dialog')
  return within(dialog).getByText(/^Market price/).parentElement as HTMLElement
}

describe('BrowseCardPanel price for the viewed printing', () => {
  it('owned with an eBay price shows it with the eBay marker, listings and checked date', async () => {
    const p = printing(10)
    renderBrowse([p], [entry(p, ebay)])
    const line = (await screen.findByText('$33.25', { selector: 'p *' })).closest('p')
    expect(line).toHaveTextContent('eBay')
    expect(await screen.findByText(/7 listings/)).toBeInTheDocument()
    expect(screen.getByText(/checked 3 days ago/)).toBeInTheDocument()
  })

  it('owned on the fallback shows the price the collection shows', async () => {
    const p = printing(10)
    renderBrowse([p], [entry(p, { unitPrice: 9.5, totalValue: 9.5 })])
    await screen.findAllByRole('group')
    const line = await marketLine()
    expect(line).toHaveTextContent('Market price · Ultra Rare $9.50')
    expect(line).not.toHaveTextContent('eBay')
  })

  it('owned non-English with no eBay price shows No price and its reason', async () => {
    const p = printing(10, { language: 'ja', setPrice: 4 })
    renderBrowse([p], [entry(p, noPrice('no-listings'))])
    expect(await screen.findByText('No price', { selector: 'p *' })).toBeInTheDocument()
    expect(screen.getByText('No eBay listings found')).toBeInTheDocument()
    expect(await marketLine()).not.toHaveTextContent('$4.00')
  })

  it('not owned keeps the YGOPRODeck price labelled by rarity', async () => {
    renderBrowse([printing(10)], [])
    await screen.findAllByRole('group')
    expect(await marketLine()).toHaveTextContent('Market price · Ultra Rare $10.00')
  })

  it('an entry of a different printing does not change the viewed printing price', async () => {
    const other = printing(11, { setCode: 'LOB-EN011' })
    renderBrowse([printing(10), other], [entry(other, ebay)])
    await screen.findAllByRole('group')
    expect(await marketLine()).toHaveTextContent('Market price · Ultra Rare $10.00')
  })
})

describe('SetCardPanel price for the viewed rarity', () => {
  const alpha = metalRaidersChecklist.cards[0]
  const viewed = printing(PRINTING.alphaUltraE001, {
    cardId: 1001,
    setName: 'Metal Raiders',
    setCode: 'MRD-E001',
    setPrice: 12
  })
  const renderSet = (entries: EntryView[], rarity = 'Ultra Rare'): void => {
    renderWithProviders(
      <CardSheet onClose={() => {}}>
        <SetCardPanel
          setName="Metal Raiders"
          card={alpha}
          rarity={rarity}
          busy={false}
          onAdjust={() => {}}
          onMoreOptions={() => {}}
        />
      </CardSheet>,
      { api: createMockApi({ collection: { forCard: async () => entries } }) }
    )
  }

  it('owned with an eBay price shows it with marker, listings and date', async () => {
    renderSet([entry(viewed, ebay)])
    const line = (await screen.findByText('$33.25', { selector: 'p *' })).closest('p')
    expect(line).toHaveTextContent('eBay')
    expect(await screen.findByText(/7 listings/)).toBeInTheDocument()
    expect(screen.getByText(/checked 3 days ago/)).toBeInTheDocument()
  })

  it('owned on the fallback shows the entry price', async () => {
    renderSet([entry(viewed, { unitPrice: 11, totalValue: 11 })])
    await screen.findByText('$11.00', { selector: 'p *' })
    expect(screen.getByText(/^Market price/).parentElement).toHaveTextContent(
      'Market price · Ultra Rare $11.00'
    )
  })

  it('owned non-English with no eBay price shows No price', async () => {
    renderSet([entry({ ...viewed, language: 'ja' }, noPrice('pending'))])
    expect(await screen.findByText('No price', { selector: 'p *' })).toBeInTheDocument()
    expect(screen.getByText('Checking eBay…')).toBeInTheDocument()
  })

  it('not owned keeps the rarity price', async () => {
    renderSet([], 'Secret Rare')
    expect(screen.getByText(/^Market price/).parentElement).toHaveTextContent(
      'Market price · Secret Rare $40.00'
    )
  })
})
