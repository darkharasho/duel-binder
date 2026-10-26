import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SetsFilterPanel, type SetsFilterPanelProps } from '@/features/sets/SetsFilterPanel'

const setup = (o: Partial<SetsFilterPanelProps> = {}) => {
  const p: SetsFilterPanelProps = {
    open: true,
    onOpenChange: vi.fn(),
    types: [],
    onTypesChange: vi.fn(),
    counts: { booster: 300, deck: 140, tin: 20, collection: 30, promo: 50 },
    filter: 'all',
    onFilterChange: vi.fn(),
    sort: 'date',
    onSortChange: vi.fn(),
    mode: 'cards',
    onModeChange: vi.fn(),
    language: 'all',
    onLanguageChange: vi.fn(),
    availableLanguages: ['en'],
    onReset: vi.fn(),
    ...o
  }
  render(<SetsFilterPanel {...p} />)
  return p
}

describe('SetsFilterPanel', () => {
  it('shows the title and section headings', () => {
    setup()
    expect(screen.getByText('Filters & sort')).toBeInTheDocument()
    for (const h of ['Type', 'Progress', 'Sort by', 'Count', 'Language'])
      expect(screen.getByText(h)).toBeInTheDocument()
  })

  it('shows type counts and toggles types in SET_TYPES order', async () => {
    const p = setup()
    expect(screen.getByText('140')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Decks/ }))
    expect(p.onTypesChange).toHaveBeenCalledWith(['deck'])
  })

  it('adds in canonical order and removes', async () => {
    const p = setup({ types: ['promo'] })
    await userEvent.click(screen.getByRole('checkbox', { name: /Decks/ }))
    expect(p.onTypesChange).toHaveBeenCalledWith(['deck', 'promo'])
  })

  it('unchecks a selected type', async () => {
    const p = setup({ types: ['deck'] })
    await userEvent.click(screen.getByRole('checkbox', { name: /Decks/ }))
    expect(p.onTypesChange).toHaveBeenCalledWith([])
  })

  it('changes progress, sort and count', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('radio', { name: 'Started' }))
    expect(p.onFilterChange).toHaveBeenCalledWith('started')
    await userEvent.click(screen.getByRole('radio', { name: 'Complete' }))
    expect(p.onFilterChange).toHaveBeenCalledWith('complete')
    await userEvent.click(screen.getByRole('radio', { name: 'Most complete' }))
    expect(p.onSortChange).toHaveBeenCalledWith('complete')
    await userEvent.click(screen.getByRole('radio', { name: 'Name' }))
    expect(p.onSortChange).toHaveBeenCalledWith('name')
    await userEvent.click(screen.getByRole('radio', { name: 'Every rarity' }))
    expect(p.onModeChange).toHaveBeenCalledWith('rarities')
  })

  it('ignores re-clicking the active item', async () => {
    const p = setup({ filter: 'all' })
    await userEvent.click(screen.getByRole('radio', { name: 'All' }))
    expect(p.onFilterChange).not.toHaveBeenCalled()
  })

  it('resets and closes on Escape', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Reset all' }))
    expect(p.onReset).toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(p.onOpenChange).toHaveBeenCalledWith(false)
  })
})
