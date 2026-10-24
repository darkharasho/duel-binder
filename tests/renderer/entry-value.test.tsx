import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EntryView } from '@shared/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EntryValue } from '@/features/collection/EntryValue'

const base = {
  unitPrice: 12.5,
  totalValue: 12.5,
  priceApproximate: false,
  priceSource: 'ebay',
  priceCheckedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  noPriceReason: null
} as unknown as EntryView

const show = (e: Partial<EntryView>): void => {
  render(
    <TooltipProvider>
      <EntryValue entry={{ ...base, ...e }} amount={e.unitPrice === null ? null : 12.5} />
    </TooltipProvider>
  )
}

describe('EntryValue', () => {
  it('shows an eBay asking price with its checked date', async () => {
    show({})
    expect(screen.getByText('$12.50')).toBeInTheDocument()
    expect(screen.getByText('eBay')).toBeInTheDocument()
    await userEvent.hover(screen.getByText('$12.50'))
    expect((await screen.findAllByText('eBay asking price · checked 3 days ago')).length).toBeGreaterThan(0)
  })

  it.each([
    ['no-listings', 'No eBay listings found'],
    ['pending', 'Checking eBay…'],
    ['unavailable', 'Prices unavailable']
  ] as const)('shows No price with a tooltip for %s', async (noPriceReason, tip) => {
    show({ unitPrice: null, noPriceReason })
    expect(screen.getByText('No price')).toBeInTheDocument()
    await userEvent.hover(screen.getByText('No price'))
    expect((await screen.findAllByText(tip)).length).toBeGreaterThan(0)
  })

  it('omits the checked clause when there is no checked date', async () => {
    show({ priceCheckedAt: null })
    await userEvent.hover(screen.getByText('$12.50'))
    expect((await screen.findAllByText('eBay asking price')).length).toBeGreaterThan(0)
  })

  it('shows a plain price for YGOPRODeck entries', () => {
    show({ priceSource: 'ygoprodeck', priceCheckedAt: null })
    expect(screen.getByText('$12.50')).toBeInTheDocument()
    expect(screen.queryByText('eBay')).not.toBeInTheDocument()
  })
})
