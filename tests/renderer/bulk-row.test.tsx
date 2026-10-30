import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChecklistCard, ChecklistRarity } from '@shared/types'
import { BulkRow } from '@/features/sets/BulkRow'

const card = { cardId: 1, name: 'Alpha' } as ChecklistCard
const rarity = (ids: number[], defaultPrintingId: number): ChecklistRarity => ({
  rarity: 'Ultra Rare',
  owned: 0,
  codes: ids.map((id) => ({ printingId: id, setCode: `MRD-${id}`, owned: 0 })),
  defaultPrintingId,
  entryId: null,
  price: null
})

describe('BulkRow', () => {
  it('falls back to the default printing when the selected one disappears', async () => {
    const onAdjust = vi.fn()
    const { rerender } = render(
      <BulkRow card={card} rarity={rarity([1, 2], 1)} busy={false} onAdjust={onAdjust} />
    )
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'MRD-2 Ultra Rare' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Ultra Rare' }))
    expect(onAdjust).toHaveBeenLastCalledWith(2, 1)

    rerender(<BulkRow card={card} rarity={rarity([1, 3], 1)} busy={false} onAdjust={onAdjust} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Ultra Rare' }))
    expect(onAdjust).toHaveBeenLastCalledWith(1, 1)
  })

  it('shows the price only when asked', () => {
    const priced = { ...rarity([1], 1), price: 4.25 }
    const { rerender } = render(
      <BulkRow card={card} rarity={priced} busy={false} onAdjust={() => {}} />
    )
    expect(screen.queryByText('$4.25')).not.toBeInTheDocument()
    rerender(<BulkRow card={card} rarity={priced} busy={false} onAdjust={() => {}} showPrice />)
    expect(screen.getByText('$4.25')).toBeInTheDocument()
  })

  it('labels each code with the set name and rarity, the closed picker with the code', async () => {
    const r = rarity([1, 2], 1)
    r.codes[1] = { printingId: 2, setCode: '', owned: 0 }
    render(
      <BulkRow card={card} rarity={r} setName="Metal Raiders" busy={false} onAdjust={() => {}} />
    )
    const combo = screen.getByRole('combobox')
    expect(combo).toHaveTextContent(/^MRD-1$/)
    await userEvent.click(combo)
    expect(
      await screen.findByRole('option', { name: 'MRD-1 Metal Raiders - Ultra Rare' })
    ).toBeInTheDocument()
    // An uncoded printing has no chip; its set's name still leads.
    expect(screen.getByRole('option', { name: 'Metal Raiders - Ultra Rare' })).toBeInTheDocument()
  })
})
