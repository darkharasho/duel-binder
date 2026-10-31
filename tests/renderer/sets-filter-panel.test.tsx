import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SetsFilterPanel, type SetsFilterPanelProps } from '@/features/sets/SetsFilterPanel'

const setup = (o: Partial<SetsFilterPanelProps> = {}) => {
  const p: SetsFilterPanelProps = {
    wide: false,
    open: true,
    onOpenChange: vi.fn(),
    types: [],
    onTypesChange: vi.fn(),
    counts: { booster: 300, deck: 140, tin: 20, collection: 30, promo: 50 },
    filter: 'all',
    onFilterChange: vi.fn(),
    mode: 'cards',
    onModeChange: vi.fn(),
    language: 'all',
    onLanguageChange: vi.fn(),
    availableLanguages: ['en'],
    onClearAll: vi.fn(),
    ...o
  }
  render(<SetsFilterPanel {...p} />)
  return p
}

describe('SetsFilterPanel', () => {
  it('shows the title and section headings, Language first', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
    const headings = screen.getAllByRole('button', { expanded: true }).map((b) => b.textContent)
    expect(headings).toEqual(['Language', 'Type', 'Progress', 'Count'])
  })

  it('shows type counts and toggles types in SET_TYPES order', async () => {
    const p = setup()
    expect(screen.getByText('140')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Decks/ }))
    expect(p.onTypesChange).toHaveBeenCalledWith(['deck'])
  })

  it('adds in canonical order and removes', async () => {
    const p = setup({ types: ['promo'] })
    await userEvent.click(screen.getByRole('button', { name: /Decks/ }))
    expect(p.onTypesChange).toHaveBeenCalledWith(['deck', 'promo'])
  })

  it('unchecks a selected type', async () => {
    const p = setup({ types: ['deck'] })
    await userEvent.click(screen.getByRole('button', { name: /Decks/ }))
    expect(p.onTypesChange).toHaveBeenCalledWith([])
  })

  it('changes progress and count', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Started' }))
    expect(p.onFilterChange).toHaveBeenCalledWith('started')
    await userEvent.click(screen.getByRole('button', { name: 'Complete' }))
    expect(p.onFilterChange).toHaveBeenCalledWith('complete')
    await userEvent.click(screen.getByRole('button', { name: 'Every rarity' }))
    expect(p.onModeChange).toHaveBeenCalledWith('rarities')
  })

  it('clears and closes on Escape', async () => {
    const p = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(p.onClearAll).toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(p.onOpenChange).toHaveBeenCalledWith(false)
  })
})
