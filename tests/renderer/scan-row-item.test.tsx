import { render, screen } from '@testing-library/react'
import { ScanRowItem, type ScanRowActions } from '@/features/scan/ScanRowItem'
import type { ScanRow } from '@/features/scan/session'
import { printing } from './scanFakes'

const actions: ScanRowActions = { setPrinting: () => {}, setQuantity: () => {}, remove: () => {} }

// Buster Blader's Manga-Style printing in the Original Artwork Collection, which has no code.
const manga = printing({
  printingId: 61362,
  name: 'Buster Blader',
  setName: 'Original Artwork Collection',
  setCode: '',
  rarity: 'Ultra Rare',
  variant: 'Manga-Style',
  language: 'ja',
  imageIds: [78193831, 78193832]
})

const row = (o: Partial<ScanRow> = {}): ScanRow => ({
  key: 'k',
  quantity: 1,
  addedAt: 0,
  cardId: 1,
  name: 'Buster Blader',
  imageId: 78193831,
  printingId: 61362,
  setCode: '',
  rarity: 'Ultra Rare',
  options: [manga],
  flag: 'pick-printing',
  via: 'art',
  ...o
})

describe('ScanRowItem', () => {
  it("shows the printing's own photo when the row keeps the card's first artwork", () => {
    render(<ScanRowItem row={row()} actions={actions} language={null} />)
    expect(screen.getByTestId('printing-scan')).toHaveAttribute('src', 'ygo-img://printing/61362')
  })

  it('keeps an alternate artwork the art match picked', () => {
    render(<ScanRowItem row={row({ imageId: 78193832 })} actions={actions} language={null} />)
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
  })

  it('names the set of a printing that has no code', () => {
    render(<ScanRowItem row={row()} actions={actions} language={null} />)
    expect(screen.getByText('Original Artwork Collection')).toBeInTheDocument()
  })
})
