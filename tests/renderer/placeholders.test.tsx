import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlaceholdersButton } from '@/features/sets/PlaceholdersDialog'
import type { PlaceholderRequest } from '@shared/placeholders'
import type { ChecklistCard, SetSummary } from '@shared/types'
import { createMockApi, renderWithProviders } from './mockApi'

const card = (number: number, owned: number): ChecklistCard =>
  ({
    cardId: number,
    name: `Card ${number}`,
    number,
    numberLabel: String(number),
    imageId: 100 + number,
    owned,
    rarities: [{ codes: [{ setCode: `DLR ${number}/103` }] }],
    cardRarity: 'Common'
  }) as ChecklistCard
const set = { setName: 'Delta Reign', setCode: 'DLR' } as SetSummary

describe('PlaceholdersButton', () => {
  const open = async (
    save = vi.fn(async (_request: PlaceholderRequest) => '/tmp/x.pdf' as string | null)
  ): Promise<typeof save> => {
    const api = createMockApi({ placeholders: { save } })
    renderWithProviders(
      <PlaceholdersButton set={set} cards={[card(3, 0), card(1, 0), card(2, 1)]} />,
      { api }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Placeholders' }))
    return save
  }

  it('prints the missing cards in number order by default', async () => {
    const save = await open()
    expect(screen.getByText('2 cards on 1 sheet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save PDF' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      setName: 'Delta Reign',
      setCode: 'DLR',
      style: 'soft',
      cards: [
        { imageId: 101, name: 'Card 1', number: 'DLR 1/103', rarity: 'Common' },
        { imageId: 103, name: 'Card 3' }
      ]
    })
  })

  it('can print the whole set in another style', async () => {
    const save = await open()
    await userEvent.click(screen.getByRole('radio', { name: 'All (3)' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Grayscale' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save PDF' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]?.[0]).toMatchObject({ style: 'gray' })
    expect(save.mock.calls[0]?.[0].cards).toHaveLength(3)
  })

  it('has nothing to save for a finished set', async () => {
    const api = createMockApi()
    renderWithProviders(<PlaceholdersButton set={set} cards={[card(1, 2)]} />, { api })
    await userEvent.click(screen.getByRole('button', { name: 'Placeholders' }))
    expect(screen.getByRole('button', { name: 'Save PDF' })).toBeDisabled()
  })
})
