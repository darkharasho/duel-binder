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
  entryId: null
})

describe('BulkRow', () => {
  it('falls back to the default printing when the selected one disappears', async () => {
    const onAdjust = vi.fn()
    const { rerender } = render(
      <BulkRow card={card} rarity={rarity([1, 2], 1)} busy={false} onAdjust={onAdjust} />
    )
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'MRD-2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Ultra Rare' }))
    expect(onAdjust).toHaveBeenLastCalledWith(2, 1)

    rerender(<BulkRow card={card} rarity={rarity([1, 3], 1)} busy={false} onAdjust={onAdjust} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add one Alpha Ultra Rare' }))
    expect(onAdjust).toHaveBeenLastCalledWith(1, 1)
  })
})
