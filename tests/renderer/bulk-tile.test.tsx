import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BulkTile } from '@/features/sets/BulkTile'
import { metalRaidersChecklist, PRINTING } from './setFixtures'

const alpha = metalRaidersChecklist.cards[0]
const secret = alpha.rarities[0]
const ultra = alpha.rarities[1]

type TileProps = React.ComponentProps<typeof BulkTile>
const props = (over: Partial<TileProps> = {}): TileProps => ({
  card: alpha,
  rarity: secret,
  setName: 'Metal Raiders',
  printingId: PRINTING.alphaSecret as number,
  onPickCode: vi.fn(),
  busy: false,
  highlighted: false,
  onAdjust: vi.fn(),
  ...over
})

describe('BulkTile', () => {
  it('renders a single-code unowned tile without a picker', () => {
    render(<BulkTile {...props()} />)
    const tile = screen.getByRole('group', { name: 'Alpha Dragon Secret Rare' })
    expect(tile).toHaveAttribute('data-tile-key', '1001:Secret Rare')
    expect(tile).toHaveAttribute('data-owned', 'false')
    expect(tile).not.toHaveAttribute('aria-current')
    expect(within(tile).getByText('MRD-001')).toBeInTheDocument()
    expect(within(tile).getByText('$40.00')).toBeInTheDocument()
    expect(within(tile).getByText('Secret Rare')).toBeInTheDocument()
    expect(within(tile).queryByRole('combobox')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove one Alpha Dragon Secret Rare' })
    ).toBeDisabled()
  })

  it('adds one from the photo and the plus button', async () => {
    const p = props()
    render(<BulkTile {...p} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Add one Alpha Dragon Secret Rare (photo)' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Dragon Secret Rare' }))
    expect(p.onAdjust).toHaveBeenCalledTimes(2)
    expect(p.onAdjust).toHaveBeenNthCalledWith(1, PRINTING.alphaSecret, 1)
    expect(p.onAdjust).toHaveBeenNthCalledWith(2, PRINTING.alphaSecret, 1)
  })

  it('shows the chosen code, removes from it, and reports picks', async () => {
    const p = props({ rarity: ultra, printingId: PRINTING.alphaUltraE001 })
    render(<BulkTile {...p} />)
    expect(screen.getByRole('group', { name: 'Alpha Dragon Ultra Rare' })).toHaveAttribute(
      'data-owned',
      'true'
    )
    const combo = screen.getByRole('combobox', { name: 'Set code for Alpha Dragon Ultra Rare' })
    expect(combo).toHaveTextContent('MRD-E001')
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove one Alpha Dragon Ultra Rare' })
    )
    expect(p.onAdjust).toHaveBeenCalledWith(PRINTING.alphaUltraE001, -1)
    await userEvent.click(combo)
    await userEvent.click(
      await screen.findByRole('option', { name: /^MRD-EN001 Metal Raiders - Ultra Rare/ })
    )
    expect(p.onPickCode).toHaveBeenCalledWith(PRINTING.alphaUltraEN001)
  })

  it('falls back to the default printing when the chosen one is gone', async () => {
    const p = props({ rarity: ultra, printingId: 999 })
    render(<BulkTile {...p} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Dragon Ultra Rare' }))
    expect(p.onAdjust).toHaveBeenCalledWith(PRINTING.alphaUltraE001, 1)
  })

  it('flags the highlighted tile', () => {
    render(<BulkTile {...props({ highlighted: true })} />)
    expect(screen.getByRole('group', { name: 'Alpha Dragon Secret Rare' })).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    expect(screen.getByRole('group', { name: 'Alpha Dragon Secret Rare' })).toHaveAttribute(
      'aria-current',
      'true'
    )
  })

  it('shows the chosen printing scan', () => {
    render(<BulkTile {...props()} />)
    expect(screen.getByTestId('printing-scan').getAttribute('src')).toContain(
      String(PRINTING.alphaSecret)
    )
  })
})
