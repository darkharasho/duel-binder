import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Printing } from '@shared/types'
import { buyLinks } from '@shared/affiliate'
import { BuyLinks } from '@/components/BuyLinks'
import { track } from '@/lib/usage'

vi.mock('@/lib/usage', () => ({ track: vi.fn() }))

const ids = {
  ebayCampaignId: '5338000000',
  tcgplayerImpactBase: 'https://tcgplayer.pxf.io/c/1/2/3'
}
const card = { id: 46986414, name: 'Dark Magician' }
const printing: Printing = {
  id: 1,
  cardId: card.id,
  setName: 'Legend of Blue Eyes White Dragon',
  setCode: 'LOB-005',
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: 10,
  missingFromApi: false
}
const DISCLOSURE = 'Affiliate links: we may earn a commission.'

describe('BuyLinks', () => {
  it('renders both links with the affiliate urls', () => {
    render(<BuyLinks card={card} printing={printing} ids={ids} />)
    const want = buyLinks(
      { game: 'ygo', name: card.name, setCode: 'LOB-005', setRarity: 'Ultra Rare', language: 'en' },
      ids
    )
    for (const l of want) {
      const a = screen.getByRole('link', { name: l.label })
      expect(a).toHaveAttribute('href', l.url)
      expect(a).toHaveAttribute('target', '_blank')
    }
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument()
  })

  it('renders nothing when both ids are blank', () => {
    const { container } = render(
      <BuyLinks
        card={card}
        printing={printing}
        ids={{ ebayCampaignId: '', tcgplayerImpactBase: '' }}
      />
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(DISCLOSURE)).toBeNull()
  })

  it('renders nothing without a printing', () => {
    const { container } = render(<BuyLinks card={card} printing={undefined} ids={ids} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('counts a click per store', async () => {
    render(<BuyLinks card={card} printing={printing} ids={ids} />)
    // Keep jsdom from trying to navigate.
    const a = screen.getByRole('link', { name: 'Buy on eBay' })
    a.addEventListener('click', (e) => e.preventDefault())
    await userEvent.click(a)
    expect(track).toHaveBeenCalledWith('buy:ebay')
  })

  it('compact shows short labels and keeps the disclosure in the title', () => {
    render(<BuyLinks card={card} printing={printing} ids={ids} compact />)
    expect(screen.getByRole('link', { name: 'eBay' })).toHaveAttribute('title', DISCLOSURE)
    expect(screen.queryByText(DISCLOSURE)).toBeNull()
  })
})
