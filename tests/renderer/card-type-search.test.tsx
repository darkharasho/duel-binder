import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Printing } from '@shared/types'
import { CardTypeList } from '@/features/card/CardTypeList'
import type { CardTypeRow } from '@/features/card/cardTypes'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const printing = (id: number, extra: Partial<Printing> = {}): Printing => ({
  id,
  cardId: 1,
  setName: `Reprint Set ${id}`,
  setCode: `RS${id}-EN001`,
  setRarity: 'Common',
  setRarityCode: '(C)',
  language: 'en',
  setPrice: 1,
  missingFromApi: false,
  ...extra
})

const rowsOf = (ps: Printing[]): CardTypeRow[] =>
  ps.map((p) => ({ key: `p${p.id}`, printing: p, viaPrinting: true }))

const show = (ps: Printing[]): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(
    <CardTypeList
      cardId={1}
      cardName="Dark Magician"
      rows={rowsOf(ps)}
      copies={[]}
      selectedKey={undefined}
      onSelect={() => {}}
    />,
    { api: createMockApi() }
  )

const many = [
  ...Array.from({ length: 9 }, (_, i) => printing(i + 1)),
  printing(10, { setName: 'Legend of Blue Eyes', setCode: 'LOB-EN005', setRarity: 'Ultra Rare' })
]

describe('CardTypeList search', () => {
  it('filters by set name, code and rarity, ignoring case', async () => {
    const user = userEvent.setup()
    show(many)
    const box = screen.getByRole('searchbox', { name: 'Search printings' })
    await user.type(box, 'blue eyes')
    expect(screen.getAllByRole('group')).toHaveLength(1)
    await user.clear(box)
    await user.type(box, 'lob-en005')
    expect(screen.getAllByRole('group')).toHaveLength(1)
    await user.clear(box)
    await user.type(box, 'ULTRA')
    expect(screen.getAllByRole('group')).toHaveLength(1)
    await user.clear(box)
    expect(screen.getAllByRole('group')).toHaveLength(10)
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    show(many)
    await user.type(screen.getByRole('searchbox', { name: 'Search printings' }), 'zzz')
    expect(screen.getByText('No prints match')).toBeInTheDocument()
    expect(screen.queryAllByRole('group')).toHaveLength(0)
  })

  it('is hidden for a short list', () => {
    show(many.slice(0, 8))
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})
